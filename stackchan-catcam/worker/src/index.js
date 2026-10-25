const JST_OFFSET_MS = 9 * 3600 * 1000;
const MAX_UPLOAD_BYTES = 1024 * 1024;
const URL_LIFETIME_SEC = 30 * 24 * 3600;
const DIGEST_PHOTO_COUNT = 4;

const encoder = new TextEncoder();

function jstNow(date = new Date()) {
  const iso = new Date(date.getTime() + JST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19).replace(/:/g, "") };
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function sign(env, key, exp) {
  const k = await hmacKey(env.SIGNING_SECRET, "sign");
  return toHex(await crypto.subtle.sign("HMAC", k, encoder.encode(`${key}.${exp}`)));
}

async function signedUrl(env, key) {
  const exp = Math.floor(Date.now() / 1000) + URL_LIFETIME_SEC;
  const sig = await sign(env, key, exp);
  return `${env.PUBLIC_BASE_URL}/img/${key}?exp=${exp}&sig=${sig}`;
}

async function verifySig(env, key, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await sign(env, key, exp);
  return expected.length === sig.length && timingSafeEqual(expected, sig);
}

function timingSafeEqual(a, b) {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  return env.UPLOAD_TOKEN && timingSafeEqual(header, `Bearer ${env.UPLOAD_TOKEN}`);
}

async function handleUpload(request, env) {
  if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
  const kind = new URL(request.url).searchParams.get("kind") === "motion" ? "motion" : "hourly";
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_UPLOAD_BYTES) {
    return new Response("bad size", { status: 413 });
  }
  const head = new Uint8Array(body, 0, 2);
  if (head[0] !== 0xff || head[1] !== 0xd8) return new Response("not a jpeg", { status: 400 });

  const { date, time } = jstNow();
  const key = `photos/${date}/${time}-${kind}.jpg`;
  await env.PHOTOS.put(key, body, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { kind },
  });
  return Response.json({ key });
}

async function handleImage(request, env, key) {
  const url = new URL(request.url);
  if (!(await verifySig(env, key, url.searchParams.get("exp"), url.searchParams.get("sig")))) {
    return new Response("forbidden", { status: 403 });
  }
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}

// その日の写真を時系列順に4等分し、各区間から動体検知の写真を優先して1枚ずつ選ぶ
export function pickPhotos(objects, count = DIGEST_PHOTO_COUNT) {
  const sorted = [...objects].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (sorted.length <= count) return sorted;
  const picks = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * sorted.length) / count);
    const to = Math.floor(((i + 1) * sorted.length) / count);
    const chunk = sorted.slice(from, to);
    const motion = chunk.filter((o) => o.key.endsWith("-motion.jpg"));
    const pool = motion.length > 0 ? motion : chunk;
    picks.push(pool[Math.floor(pool.length / 2)]);
  }
  return picks;
}

function imageBox(url) {
  return {
    type: "image",
    url,
    size: "full",
    aspectMode: "cover",
    aspectRatio: "4:3",
    flex: 1,
    action: { type: "uri", uri: url },
  };
}

export function buildFlex(date, urls) {
  const rows = [];
  for (let i = 0; i < urls.length; i += 2) {
    rows.push({
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: urls.slice(i, i + 2).map(imageBox),
    });
  }
  return {
    type: "flex",
    altText: `今日の猫（${date}）`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "text", text: `🐱 今日の猫 ${date}`, weight: "bold" }],
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
    },
  };
}

async function lineSend(env, message) {
  const endpoint = env.LINE_TO ? "push" : "broadcast";
  const payload = env.LINE_TO ? { to: env.LINE_TO, messages: [message] } : { messages: [message] };
  const res = await fetch(`https://api.line.me/v2/bot/message/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LINE ${endpoint} failed: ${res.status} ${await res.text()}`);
}

async function sendDigest(env) {
  const { date } = jstNow();
  const listed = await env.PHOTOS.list({ prefix: `photos/${date}/` });
  const picks = pickPhotos(listed.objects);
  if (picks.length === 0) {
    await lineSend(env, { type: "text", text: `${date} は写真を撮れませんでした。` });
    return { date, sent: 0 };
  }
  const urls = await Promise.all(picks.map((o) => signedUrl(env, o.key)));
  await lineSend(env, buildFlex(date, urls));
  return { date, sent: picks.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/upload") return handleUpload(request, env);
    if (request.method === "GET" && url.pathname.startsWith("/img/")) {
      return handleImage(request, env, decodeURIComponent(url.pathname.slice("/img/".length)));
    }
    if (request.method === "POST" && url.pathname === "/digest") {
      if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
      return Response.json(await sendDigest(env));
    }
    return new Response("not found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDigest(env));
  },
};
