// Xcode を開く前にブリッジ単体が動いているか確かめるための、素朴な動作確認ページ。
export function testPage() {
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AvatarTalk bridge</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.7 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.2rem; }
  input, textarea, button { font: inherit; width: 100%; padding: .5rem; box-sizing: border-box; }
  button { width: auto; padding: .5rem 1.2rem; margin-top: .5rem; }
  label { display: block; margin-top: .8rem; font-size: .85rem; opacity: .8; }
  #out { white-space: pre-wrap; border: 1px solid currentColor; border-radius: .4rem;
         padding: .8rem; margin-top: 1rem; min-height: 4rem; opacity: .95; }
  .muted { opacity: .6; font-size: .85rem; }
</style>
<h1>AvatarTalk bridge 動作確認</h1>
<p class="muted">ここで返事が返ってくれば、iOS アプリからも同じ設定でつながります。</p>
<label>BRIDGE_TOKEN</label>
<input id="token" type="password" placeholder=".env に設定した値">
<label>メッセージ</label>
<textarea id="msg" rows="3">はじめまして。自己紹介して。</textarea>
<button id="send">送信</button>
<div id="out"></div>
<script>
let sessionId = localStorage.getItem("sid") || null;
const out = document.getElementById("out");
document.getElementById("token").value = localStorage.getItem("tok") || "";

document.getElementById("send").onclick = async () => {
  const token = document.getElementById("token").value;
  localStorage.setItem("tok", token);
  out.textContent = "";
  const res = await fetch("/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ sessionId, message: document.getElementById("msg").value }),
  });
  if (!res.ok) { out.textContent = "HTTP " + res.status + " " + (await res.text()); return; }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const frames = buf.split("\\n\\n");
    buf = frames.pop();
    for (const frame of frames) {
      const ev = (frame.match(/^event: (.*)$/m) || [])[1];
      const dataLine = (frame.match(/^data: (.*)$/m) || [])[1];
      if (!ev || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (ev === "delta") out.textContent += data.text;
      if (ev === "session") { sessionId = data.sessionId; localStorage.setItem("sid", sessionId); }
      if (ev === "error") out.textContent += "\\n[エラー] " + data.message;
    }
  }
};
</script>
</html>`;
}
