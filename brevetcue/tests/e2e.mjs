/* Playwrightによる通しテスト
   使い方: node tests/e2e.mjs [--headed]
   ・サンプルGPX/Excelを読み込ませ、生成→プレビューまでを検証する */
/* playwrightはグローバル導入でも動くよう動的に解決する */
async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright',
    '/opt/node22/lib/node_modules/playwright/index.js',
    '/usr/lib/node_modules/playwright/index.js'].filter(Boolean);
  for (const c of candidates) {
    try { return await import(c); } catch (e) { /* 次の候補を試す */ }
  }
  throw new Error('playwright が見つかりません（npm i -g playwright）');
}
const pw = await loadPlaywright();
const chromium = pw.chromium || (pw.default && pw.default.chromium);
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT_DIR || '/tmp';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
}

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
const errors = [];
// 意図的にリクエストを遮断する区間では、ネットワーク由来のconsoleエラーは無視する
let allowNetErrors = false;
const isNetError = t => /Failed to load resource|net::ERR/.test(t);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error' && !(allowNetErrors && isNetError(m.text()))) errors.push('console: ' + m.text());
});

/* 外部サービスをスタブする（この環境はブラウザから外に出られないため） */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
await page.route('**cyberjapandata.gsi.go.jp/**', route =>
  route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));

const hoursBetween = (from, to) => {
  const out = [];
  for (let d = new Date(from); d <= new Date(to + 'T23:00'); d = new Date(d.getTime() + 3600000)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`);
  }
  return out;
};
const seriesFor = times => ({
  time: times,
  temperature_2m: times.map(() => 12.3),
  precipitation: times.map(() => 0.4),
  windspeed_10m: times.map(() => 5.6),
  winddirection_10m: times.map(() => 90)      // 東風
});
await page.route('**/api.open-meteo.com/**', route => {
  const u = new URL(route.request().url());
  const lats = (u.searchParams.get('latitude') || '').split(',');
  const times = u.searchParams.get('start_date')
    ? hoursBetween(u.searchParams.get('start_date') + 'T00:00', u.searchParams.get('end_date'))
    : hoursBetween(new Date().toISOString().slice(0, 10) + 'T00:00',
                   new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
  const one = i => ({ latitude: +lats[i], longitude: 0, hourly: seriesFor(times) });
  const body = lats.length > 1 ? lats.map((_, i) => one(i)) : one(0);
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(base, { waitUntil: 'load' });

/* --- STEP1: ファイル読み込み --- */
await page.setInputFiles('#file-gpx', path.join(root, 'samples/demo.gpx'));
await page.setInputFiles('#file-xlsx', path.join(root, 'samples/demo.xlsx'));
await page.waitForSelector('#step2:not(.hidden)');

const gpxStatus = await page.textContent('#status-gpx');
check('GPXを読み込める', /215\.\d ?km/.test(gpxStatus), gpxStatus);

const sheetRoles = await page.$$eval('[data-role]', els => els.map(e => e.value));
check('シート種別を自動推定できる', sheetRoles[0] === 'simple' && sheetRoles[1] === 'detail', JSON.stringify(sheetRoles));

const mapped = await page.$$eval('#sheets .sheet:first-child select[data-col]', els =>
  Object.fromEntries(els.map(e => [e.dataset.col, e.value])));
check('簡易シートの列を自動割当できる',
  mapped.name !== '' && mapped.dist !== '' && mapped.open !== '' && mapped.close !== '', JSON.stringify(mapped));

const title = await page.inputValue('#opt-title');
const dateVal = await page.inputValue('#opt-date');
const timeVal = await page.inputValue('#opt-time');
check('大会名・出走日時を推測できる', /デモBRM1010/.test(title) && dateVal.endsWith('-10-10') && timeVal === '18:00',
  `${title} / ${dateVal} ${timeVal}`);

/* --- STEP3: 生成（開催日を予報範囲内にして埋め込みも走らせる） --- */
const rideDay = new Date(Date.now() + 2 * 86400000);
const rideYmd = `${rideDay.getFullYear()}-${String(rideDay.getMonth() + 1).padStart(2, '0')}-${String(rideDay.getDate()).padStart(2, '0')}`;
await page.fill('#opt-date', rideYmd);
await page.click('#btn-generate');
await page.waitForSelector('#step4:not(.hidden)');
check('生成でエラーが出ない', await page.isHidden('#gen-error'));

const frame = page.frameLocator('#preview');
await frame.locator('#cp-list .cp-item').first().waitFor();

const sizeText = await page.textContent('#filesize');
check('天気と地図を埋め込む', /天気\d+地点/.test(sizeText) && /地図\d+タイル/.test(sizeText), sizeText);

const cpCount = await frame.locator('#cp-list .cp-item').count();
check('簡易版に6CPが並ぶ', cpCount === 6, `${cpCount}件`);

const cueCount = await frame.locator('#cue-list > div').count();
check('詳細版に全ポイントが並ぶ', cueCount >= 50, `${cueCount}行`);

const firstEta = await frame.locator('#cp-list [data-eta] .eta-time').first().textContent();
check('ETAが計算される', /^\d{2}:\d{2}$/.test(firstEta), firstEta);

const goalClose = await frame.locator('#banner-goalclose').textContent();
check('日跨ぎのCloseが「翌」表記になる', /翌\d{2}:\d{2}/.test(goalClose), goalClose);

const sun = await frame.locator('#banner-sun').textContent();
const sunM = sun.match(/日出(\d{2}):(\d{2}).*日没(\d{2}):(\d{2})/);
check('日出・日没を計算する（JST）',
  sunM && +sunM[1] >= 4 && +sunM[1] <= 7 && +sunM[3] >= 16 && +sunM[3] <= 19, sun);

/* 速度ステッパー → ETAが変わる */
const etaBefore = await frame.locator('#cp-list [data-eta] .eta-time').last().textContent();
await frame.locator('nav button[data-view="simple"]').click();
await frame.locator('.settings .stepper-btn', { hasText: '+1' }).first().click();
const etaAfter = await frame.locator('#cp-list [data-eta] .eta-time').last().textContent();
check('速度変更でETAが更新される', etaBefore !== etaAfter, `${etaBefore} → ${etaAfter}`);

/* 距離補正 */
const distBefore = await frame.locator('#cp-list .dist-val').last().textContent();
await frame.locator('.settings .stepper-btn.big', { hasText: '+1' }).click();
const distAfter = await frame.locator('#cp-list .dist-val').last().textContent();
check('距離補正で距離表示が一斉に変わる',
  Math.abs(parseFloat(distAfter) - parseFloat(distBefore) - 1) < 0.001, `${distBefore} → ${distAfter}`);
await frame.locator('.link-btn', { hasText: 'リセット' }).click();

/* 休憩ステッパー */
await frame.locator('#cp-list .cp-item').nth(1).locator('.cp-head').click();
const etaGoalBefore = await frame.locator('#cp-list [data-eta] .eta-time').last().textContent();
await frame.locator('#cp-list .cp-item').nth(1).locator('.rest-btn', { hasText: '+3時間' }).click();
const etaGoalAfter = await frame.locator('#cp-list [data-eta] .eta-time').last().textContent();
check('休憩（宿泊）でその先のETAがシフトする', etaGoalBefore !== etaGoalAfter, `${etaGoalBefore} → ${etaGoalAfter}`);

/* 詳細タブ */
await frame.locator('nav button[data-view="detail"]').click();
const turnArrows = await frame.locator('#cue-list .turn-arrow').count();
check('詳細版に進路アイコンが出る', turnArrows > 40, `${turnArrows}個`);
const roadText = await frame.locator('#cue-list .turn-road').first().textContent();
check('道路名がExcelから取り込まれる', /→/.test(roadText), roadText);
const cpRowsInDetail = await frame.locator('#cue-list .cp-row').count();
check('詳細版にもCP行が重複なく入る', cpRowsInDetail === 6, `${cpRowsInDetail}行`);

/* 天気・地図パネル（閲覧時に通信できる場合）
   曲がり角は地図を埋め込んでいない（既定はCPのみ）ので、埋め込み地図が使われるCPと動作が分かれる */
await page.route('**/openstreetmap.org/**', route =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<p>map stub</p>' }));

const turnBtns = frame.locator('#cue-list .turn-row .wx-toggle-btn');
await turnBtns.first().click();
const turnPanel = frame.locator('#cue-list .turn-row .wx-panel.open').first();
await turnPanel.locator('iframe').waitFor({ state: 'attached' });
const mapSrc = await turnPanel.locator('iframe').getAttribute('src');
check('地図パネルが該当座標で開く', /openstreetmap\.org\/export\/embed/.test(mapSrc) && /marker=4[23]\./.test(mapSrc));

await turnPanel.locator('.wx-weather-card').waitFor({ timeout: 15000 });
const wxText = (await turnPanel.locator('.wx-weather-card').innerText()).replace(/\n+/g, ' ');
check('天気カードに気温・風・降水量が出る',
  /12\.3℃/.test(wxText) && /5\.6m\/s/.test(wxText) && /0\.4mm/.test(wxText) && /東/.test(wxText), wxText);
check('進行方位と風向から向かい風／追い風を判定する', /向かい風|追い風|横風/.test(wxText), wxText.split(' ')[0]);

/* 通信できないときは、埋め込んだ予報に切り替わる */
allowNetErrors = true;
await page.unroute('**/api.open-meteo.com/**');
await page.route('**/api.open-meteo.com/**', route => route.abort());
await turnBtns.nth(20).click();
const fbPanel = frame.locator('#cue-list .turn-row .wx-panel.open').nth(1);
await fbPanel.locator('.wx-weather-card').waitFor({ timeout: 20000 });
check('通信できないときは埋め込み予報に切り替わる',
  /埋め込み分を表示/.test(await fbPanel.locator('.wx-stamp').innerText()),
  await fbPanel.locator('.wx-stamp').innerText());

check('地図の下にリンク行を置かない', await turnPanel.locator('.wx-map-links').count() === 0);

/* iOSのChrome/Edgeがローカルファイルを開く内部スキーム（edge://external-file）を再現 */
const outFrame = page.frames().find(f => f !== page.mainFrame());
await outFrame.evaluate(() => { window.__CUE_SCHEME__ = 'app'; });
await turnBtns.nth(30).click();
const appPanel = frame.locator('#cue-list .turn-row .wx-panel.open').nth(2);
await appPanel.locator('.wx-sketch').waitFor({ timeout: 5000 });
check('タイルを埋め込まなかった地点はGPXの略図を出す',
  await appPanel.locator('.wx-sketch svg path.rt-out').count() === 1 &&
  await appPanel.locator('.wx-sketch svg polygon.rt-arrow').count() === 1 &&
  /北が上/.test(await appPanel.locator('.wx-attr').innerText()),
  await appPanel.locator('.wx-attr').innerText());
check('内部スキームでは空の地図枠を出さない', await appPanel.locator('iframe').count() === 0);
const sketchHref = await appPanel.locator('a.wx-map-tap').first().getAttribute('href');
check('略図をタップするとGoogleマップに飛ぶ',
  /google\.com\/maps\/search\/\?api=1&query=4[23]\.\d+,14[01]\.\d+/.test(sketchHref), sketchHref);
check('埋め込み天気は待たずに出る',
  /埋め込み予報/.test(await appPanel.locator('.wx-stamp').innerText()) &&
  !/通信できないため/.test(await appPanel.locator('.wx-stamp').innerText()),
  await appPanel.locator('.wx-stamp').innerText());

/* iPhoneのローカルファイル状態でも、埋め込んだ地図と天気は表示できる */
await frame.locator('#cue-list .cp-row .wx-toggle-btn').nth(1).click();
const cpPanel = frame.locator('#cue-list .cp-row .wx-panel.open').first();
await cpPanel.locator('.wx-static-map').waitFor({ timeout: 5000 });
check('通信なしで埋め込み地図を表示する',
  await cpPanel.locator('.wx-static-map img').count() > 0 &&
  await cpPanel.locator('.wx-static-map svg path.rt-out').count() === 1 &&
  /地理院タイル/.test(await cpPanel.locator('.wx-attr').innerText()),
  (await cpPanel.locator('.wx-static-map img').count()) + 'タイル / ' + await cpPanel.locator('.wx-attr').innerText());
const tileHref = await cpPanel.locator('a.wx-map-tap').first().getAttribute('href');
check('埋め込み地図をタップするとGoogleマップに飛ぶ',
  /google\.com\/maps\/search\/\?api=1&query=/.test(tileHref) &&
  await cpPanel.locator('a.wx-map-tap .wx-static-map').count() === 1, tileHref);
const embWx = (await cpPanel.locator('.wx-weather-card').innerText()).replace(/\n+/g, ' ');
check('通信なしで埋め込み天気を表示する',
  /12\.3℃/.test(embWx) && /5\.6m\/s/.test(embWx) && /埋め込み予報/.test(await cpPanel.locator('.wx-stamp').innerText()), embWx);
await outFrame.evaluate(() => { delete window.__CUE_SCHEME__; });

/* マッチング精度レポート */
const reportRows = await page.locator('#report tbody tr').count();
check('座標マッチング結果を出力する', reportRows === cueCount, `${reportRows}行 / 出力${cueCount}行`);
const wptSnap = await page.textContent('#report');
check('ウェイポイント名の一致でスナップする', /ウェイポイント/.test(wptSnap));

/* 生成物を保存 */
const html = await page.evaluate(async () => {
  const res = await fetch(document.getElementById('preview').src);
  return res.text();
});
fs.writeFileSync(path.join(OUT, 'demo-cuesheet.html'), html);
check('生成HTMLが単一ファイルで完結する',
  !/<script[^>]+src=/.test(html) && !/<link[^>]+stylesheet/.test(html), `${(html.length / 1024).toFixed(0)}KB`);

await page.screenshot({ path: path.join(OUT, 'shot-generator.png'), fullPage: false });
const pv = await page.$('#preview');
await pv.screenshot({ path: path.join(OUT, 'shot-output-detail.png') });
await frame.locator('nav button[data-view="simple"]').click();
await pv.screenshot({ path: path.join(OUT, 'shot-output-simple.png') });

/* ダークモード */
await page.emulateMedia({ colorScheme: 'dark' });
await pv.screenshot({ path: path.join(OUT, 'shot-output-simple-dark.png') });
const bg = await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
check('ダークモードで背景が黒になる', bg === 'rgb(0, 0, 0)', bg);
await page.emulateMedia({ colorScheme: 'light' });

/* ================= シナリオ2：GPXのみ（Excel無し） ================= */
const page2 = await browser.newPage({ viewport: { width: 430, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
page2.on('pageerror', e => errors.push('pageerror(gpx only): ' + e.message));
page2.on('console', m => {
  if (m.type() === 'error' && !isNetError(m.text())) errors.push('console(gpx only): ' + m.text());
});
await page2.goto(base, { waitUntil: 'load' });
await page2.setInputFiles('#file-gpx', path.join(root, 'samples/demo.gpx'));
await page2.fill('#opt-date', '2026-10-10');
await page2.fill('#opt-time', '18:00');
await page2.route('**/api.open-meteo.com/**', route => route.abort());
await page2.route('**cyberjapandata.gsi.go.jp/**', route => route.abort());
await page2.click('#btn-generate');
await page2.waitForSelector('#step4:not(.hidden)', { timeout: 60000 });
const warn = await page2.textContent('#gen-error');
check('GPXのみでも生成でき、補完内容が警告される',
  /ウェイポイント/.test(warn) && /ACP基準/.test(warn) && /自動抽出/.test(warn), warn.replace(/\n/g, ' / '));
const f2 = page2.frameLocator('#preview');
await f2.locator('#cp-list .cp-item').first().waitFor();
const cp2 = await f2.locator('#cp-list .cp-item').count();
check('GPXのウェイポイントからCPを構成する', cp2 === 6, `${cp2}件`);
const close2 = await f2.locator('#cp-list .chip-close').last().textContent();
check('ACP基準のCloseが入る', /Close(翌)?\d{2}:\d{2}/.test(close2.replace(/\s/g, '')), close2.replace(/\s+/g, ''));
await f2.locator('nav button[data-view="detail"]').click();
const autoTurns = await f2.locator('#cue-list .turn-arrow').count();
check('GPXから曲がり角を自動抽出する', autoTurns >= 40 && autoTurns <= 70, `${autoTurns}個`);
/* 埋め込みが無い状態で通信できないと、理由と再試行ボタンが出る */
await f2.locator('#start-date').fill(rideYmd);          // 予報範囲内にして取得を試みさせる
await f2.locator('#start-date').dispatchEvent('change');
await f2.locator('#cue-list .turn-row .wx-toggle-btn').first().click();
const errPanel = f2.locator('#cue-list .turn-row .wx-panel.open').first();
await errPanel.locator('.wx-error').waitFor({ timeout: 20000 });
const errText = (await errPanel.locator('.wx-error').innerText()).replace(/\n+/g, ' ');
check('取得失敗時に理由と接続先を表示する',
  /取得できませんでした/.test(errText) && /api\.open-meteo\.com/.test(errText), errText);
check('再試行ボタンが出る', await errPanel.locator('.wx-retry').count() === 1);

/* 埋め込み天気が無い状態で内部スキームなら、待たずに理由を出す */
const out2 = page2.frames().find(f => f !== page2.mainFrame());
await out2.evaluate(() => { window.__CUE_SCHEME__ = 'app'; });
await f2.locator('#cue-list .turn-row .wx-toggle-btn').nth(5).click();
const noteP = f2.locator('#cue-list .turn-row .wx-panel.open').nth(1);
await noteP.locator('.wx-net-note').waitFor({ timeout: 5000 });
const noteText = (await noteP.locator('.wx-net-note').innerText()).replace(/\n+/g, ' ');
check('内部スキーム＋埋め込み無しなら待たずに理由を出す',
  /端末内のファイル/.test(noteText) && /オンラインのURLから開くと表示されます/.test(noteText),
  noteText.slice(0, 60) + '…');

await page2.close();

/* ================= シナリオ3：区間距離しか無いExcel ================= */
const page3 = await browser.newPage({ viewport: { width: 430, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
page3.on('pageerror', e => errors.push('pageerror(segment): ' + e.message));
page3.on('console', m => {
  if (m.type() === 'error' && !isNetError(m.text())) errors.push('console(segment): ' + m.text());
});
await page3.route('**cyberjapandata.gsi.go.jp/**', route => route.abort());
await page3.route('**/api.open-meteo.com/**', route => route.abort());
await page3.goto(base, { waitUntil: 'load' });
await page3.setInputFiles('#file-gpx', path.join(root, 'samples/demo.gpx'));
await page3.setInputFiles('#file-xlsx', path.join(root, 'samples/demo-segment.xlsx'));
await page3.waitForSelector('#step2:not(.hidden)');
await page3.fill('#opt-date', '2026-10-10');
await page3.selectOption('#opt-embed-map', 'none');
await page3.click('#btn-generate');
await page3.waitForSelector('#step4:not(.hidden)', { timeout: 60000 });

const segWarn = await page3.textContent('#gen-error');
check('区間距離のExcelを積算に変換して知らせる',
  /区間距離と判断/.test(segWarn) && /21[0-9]\.\dkm/.test(segWarn), (segWarn.match(/[^⚠]*区間距離[^⚠]*/) || [''])[0].trim());

const f3 = page3.frameLocator('#preview');
await f3.locator('#cp-list .cp-item').first().waitFor();
await f3.locator('nav button[data-view="detail"]').click();
await f3.locator('#cue-list > div').first().waitFor();
const dists = (await f3.locator('#cue-list .dist-val').allTextContents()).map(parseFloat);
const monotonic = dists.every((v, i) => i === 0 || v >= dists[i - 1] - 0.001);
check('詳細版の距離が積算になり単調増加する',
  monotonic && dists[dists.length - 1] > 200 && dists[dists.length - 1] < 220,
  `${dists[0]} … ${dists[dists.length - 1]} km / ${dists.length}行`);

const firstTurn = await f3.locator('#cue-list .turn-row .turn-place').first().textContent();
check('曲がり角の並びが崩れない', /No\.1[^0-9]/.test(firstTurn), firstTurn.trim());

const cpKm = (await f3.locator('#cp-list .dist-val').allTextContents()).map(parseFloat);
check('CPの距離も積算になる',
  cpKm.length === 6 && cpKm[0] === 0 && cpKm[5] > 200, cpKm.join(' / '));
await page3.close();

check('JSエラーが発生しない', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
