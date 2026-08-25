import http from "node:http";
import crypto from "node:crypto";
import { config } from "./config.mjs";
import { testPage } from "./testpage.mjs";

const backend =
  config.backend === "api"
    ? (await import("./backend-api.mjs")).createApiBackend()
    : (await import("./backend-agent.mjs")).createAgentBackend();

if (!config.bridgeToken || config.bridgeToken === "change-me-to-a-long-random-string") {
  console.error(
    "[avatartalk] BRIDGE_TOKEN が未設定です。.env に長いランダム文字列を入れてください。",
  );
  console.error("[avatartalk] 例: BRIDGE_TOKEN=" + crypto.randomBytes(24).toString("hex"));
  process.exit(1);
}

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(config.bridgeToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sseOpen(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return json(res, 400, { error: String(e.message ?? e) });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json(res, 400, { error: "message が空です" });

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;

  sseOpen(res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  const started = Date.now();
  try {
    const result = await backend.chat({
      sessionId,
      message,
      signal: abort.signal,
      onDelta: (text) => sseSend(res, "delta", { text }),
    });
    if (result.sessionId && result.sessionId !== sessionId) {
      sseSend(res, "session", { sessionId: result.sessionId });
    }
    sseSend(res, "done", {
      sessionId: result.sessionId,
      elapsedMs: Date.now() - started,
      usage: result.usage ?? null,
    });
    console.log(
      `[avatartalk] ${backend.name} ${Date.now() - started}ms in=${message.length} out=${result.text.length}`,
    );
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error("[avatartalk] chat failed:", e);
      sseSend(res, "error", {
        message: e?.message ?? "不明なエラーです",
        code: e?.code ?? null,
      });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(testPage());
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, ...backend.describe() });
  }

  if (!authorized(req)) {
    return json(res, 401, { error: "unauthorized" });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat") {
    return handleChat(req, res);
  }

  if (req.method === "POST" && url.pathname === "/v1/reset") {
    const body = await readJson(req).catch(() => ({}));
    await backend.reset(body.sessionId ?? null);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not found" });
});

server.listen(config.port, config.host, () => {
  console.log(
    `[avatartalk] backend=${backend.name} model=${config.model} listening on http://${config.host}:${config.port}`,
  );
  console.log("[avatartalk] 動作確認用ページ: http://localhost:" + config.port + "/");
});
