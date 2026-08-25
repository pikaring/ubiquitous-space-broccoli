// api バックエンド:
// Anthropic API を直接叩く。API キーが必要で、トークンの従量課金がかかる。
// Pro プランの範囲で済ませたい場合は agent バックエンドを使うこと。
// こちらは「配布したい」「サーバーを常時動かしたい」ときの選択肢。
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { config, readPersona } from "./config.mjs";

export function createApiBackend() {
  const client = new Anthropic(); // ANTHROPIC_API_KEY を環境から拾う
  const persona = readPersona();

  /** @type {Map<string, {messages: Anthropic.MessageParam[], touched: number}>} */
  const sessions = new Map();

  function getSession(sessionId) {
    const id = sessionId ?? crypto.randomUUID();
    let s = sessions.get(id);
    if (!s) {
      s = { messages: [], touched: Date.now() };
      sessions.set(id, s);
    }
    s.touched = Date.now();
    return { id, session: s };
  }

  // 一日触られていないセッションは捨てる。
  setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, s] of sessions) if (s.touched < cutoff) sessions.delete(id);
  }, 60 * 60 * 1000).unref();

  return {
    name: "api",
    describe() {
      return {
        backend: "api",
        model: config.model,
        billing: "usage",
        note: "Anthropic API 直叩き。トークン従量課金あり。",
      };
    },

    async chat({ sessionId, message, onDelta, signal }) {
      const { id, session } = getSession(sessionId);
      const messages = [...session.messages, { role: "user", content: message }];

      const stream = client.beta.messages.stream(
        {
          model: config.model,
          // 音声で読み上げる短い返事なので、あえて低く抑えている。
          max_tokens: config.maxReplyTokens,
          // 会話のたびに同じペルソナを送るのでキャッシュに乗せる。
          system: [
            {
              type: "text",
              text: persona,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
          // 雑談なので浅く速く。thinking は切らずに effort を下げるのが推奨。
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          // ポリシー上の拒否が出たときに、同じ呼び出しの中で別モデルへ回してもらう。
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      let streamed = "";
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          streamed += event.delta.text;
          onDelta(event.delta.text);
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        const err = new Error(
          "この話題には答えられないと判断されました。別の言い方で聞いてみてください。",
        );
        err.code = "refusal";
        throw err;
      }

      session.messages = [
        ...messages,
        { role: "assistant", content: streamed },
      ].slice(-config.historyTurns * 2);

      return {
        sessionId: id,
        text: streamed,
        usage: {
          input: final.usage?.input_tokens ?? 0,
          output: final.usage?.output_tokens ?? 0,
          cacheRead: final.usage?.cache_read_input_tokens ?? 0,
        },
      };
    },

    async reset(sessionId) {
      if (sessionId) sessions.delete(sessionId);
    },
  };
}
