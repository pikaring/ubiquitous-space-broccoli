// agent バックエンド:
// Claude Agent SDK（＝ Claude Code をライブラリとして使うもの）越しに会話する。
// 認証はこのマシンの Claude Code のログインをそのまま使うので、
// Pro / Max のサブスクで動き、トークンの従量課金は発生しない。
// （代わりに Pro のレート制限にはかかる。詳しくは README を参照）
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config, readPersona } from "./config.mjs";

// Claude Code はセッションの記録を cwd ごとに保存する。
// 会話ログが手元のリポジトリに混ざらないよう、専用の空ディレクトリを使う。
const workdir = path.join(config.root, ".sessions");
fs.mkdirSync(workdir, { recursive: true });

// 会話相手にファイル操作やコマンド実行はさせない。
const DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
];

const ERROR_MESSAGES = {
  authentication_failed:
    "Claude Code のログインが切れています。ブリッジを動かしているマシンで `claude` にログインし直すか、`claude setup-token` で取り直したトークンを CLAUDE_CODE_OAUTH_TOKEN に設定してください。",
  rate_limit:
    "いまプランの利用上限に達しています。しばらく待つと自動的に戻ります。",
  account_on_hold: "アカウントが保留状態です。請求設定を確認してください。",
  billing_error: "請求まわりのエラーが返ってきました。",
  overloaded: "サーバーが混み合っています。少し待ってからもう一度どうぞ。",
  model_not_found: `モデル ${config.model} が使えません。MODEL の設定を見直してください。`,
  max_output_tokens: "返事が長すぎて途中で切れました。",
};

export function createAgentBackend() {
  const persona = readPersona();

  return {
    name: "agent",
    describe() {
      return {
        backend: "agent",
        model: config.model,
        billing: "subscription",
        note: "Claude Code のログイン（Pro/Max サブスク）を使用。トークン従量課金なし。",
      };
    },

    /**
     * @param {object} params
     * @param {string|null} params.sessionId  続きから話す場合の Claude Code セッション ID
     * @param {string} params.message         ユーザーの発話
     * @param {(text: string) => void} params.onDelta  文字が届くたびに呼ばれる
     * @param {AbortSignal} params.signal
     */
    async chat({ sessionId, message, onDelta, signal }) {
      const abortController = new AbortController();
      const forward = () => abortController.abort();
      signal?.addEventListener("abort", forward, { once: true });

      const options = {
        systemPrompt: persona,
        model: config.model,
        cwd: workdir,
        // ユーザーの ~/.claude や プロジェクトの CLAUDE.md を読み込ませない。
        // これがないと会話相手が「コーディング支援」の人格を引きずる。
        settingSources: [],
        allowedTools: [],
        disallowedTools: DISALLOWED_TOOLS,
        maxTurns: 1,
        includePartialMessages: true,
        abortController,
      };
      if (sessionId) {
        options.resume = sessionId;
        options.forkSession = false;
      }
      if (process.env.CLAUDE_CLI_PATH) {
        options.pathToClaudeCodeExecutable = process.env.CLAUDE_CLI_PATH;
      }

      let newSessionId = sessionId ?? null;
      let streamed = "";
      let failure = null;

      for await (const msg of query({ prompt: message, options })) {
        if (msg.session_id) newSessionId = msg.session_id;

        switch (msg.type) {
          // includePartialMessages: true のときは、本文はここに 1 文字ずつ届く。
          case "stream_event": {
            const ev = msg.event;
            if (
              ev?.type === "content_block_delta" &&
              ev.delta?.type === "text_delta" &&
              ev.delta.text
            ) {
              streamed += ev.delta.text;
              onDelta(ev.delta.text);
            }
            break;
          }
          case "assistant": {
            // 本文は stream_event 側で受け取り済みなので、ここではエラーだけ見る。
            if (msg.error) failure = msg.error;
            break;
          }
          case "result": {
            if (msg.is_error) {
              failure = failure ?? msg.subtype ?? "unknown";
            } else if (!streamed && typeof msg.result === "string") {
              // 差分が一度も来なかった場合の保険。
              streamed = msg.result;
              onDelta(msg.result);
            }
            break;
          }
          default:
            break;
        }
      }

      signal?.removeEventListener("abort", forward);

      if (failure && !streamed) {
        const detail =
          ERROR_MESSAGES[failure] ?? `Claude 側でエラーが起きました (${failure})`;
        const err = new Error(detail);
        err.code = failure;
        throw err;
      }

      return { sessionId: newSessionId, text: streamed };
    },

    async reset(sessionId) {
      // Claude Code のセッションは JSONL として残るが、
      // アプリ側が新しい sessionId で話し始めれば実質リセットになる。
      // ここでは何もしない（履歴ファイルの掃除は運用側の判断に任せる）。
      void sessionId;
    },
  };
}
