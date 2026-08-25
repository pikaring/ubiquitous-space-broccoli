import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// .env を読む（依存を増やしたくないので最小限のパーサ）。
// 既に環境変数が立っている場合はそちらを優先する。
function loadDotEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function int(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  root,
  backend: (process.env.BACKEND ?? "agent").toLowerCase(),
  port: int("PORT", 8787),
  host: process.env.HOST ?? "0.0.0.0",
  bridgeToken: process.env.BRIDGE_TOKEN ?? "",
  model: process.env.MODEL ?? "claude-opus-5",
  maxReplyTokens: int("MAX_REPLY_TOKENS", 2000),
  historyTurns: int("HISTORY_TURNS", 20),
  personaPath: process.env.PERSONA_PATH ?? path.join(root, "persona.md"),
};

export function readPersona() {
  try {
    return fs.readFileSync(config.personaPath, "utf8").trim();
  } catch {
    return "あなたは 3D アバターの姿で会話する相手です。日本語で、1〜3 文の短い話し言葉で答えてください。";
  }
}
