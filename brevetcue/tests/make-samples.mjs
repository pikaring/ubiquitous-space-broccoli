/* デモ用サンプル（GPX + Excel）を生成する。架空のコース・架空の店名を使用。
   使い方: node tests/make-samples.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const XLSX = createRequire(import.meta.url)(path.join(root, 'vendor/xlsx.full.min.js'));

const R = 6371008.8;
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function destination(lat, lon, brgDeg, distM) {
  const d = distM / R, b = toRad(brgDeg), p1 = toRad(lat), l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), ((toDeg(l2) + 540) % 360) - 180];
}
function haversine(a, b, c, d) {
  const p1 = toRad(a), p2 = toRad(c), dp = toRad(c - a), dl = toRad(d - b);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
// 決定論的な擬似乱数
let seed = 20260912;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const ROADS = ['R228', 'R229', 'R5', 'R278', 'r5', 'r67', 'r383', 'r43', '市道', '町道', '農道', 'サイクリングロード'];
const LANDMARKS = ['道の駅の先', '橋を渡ってすぐ', '大きな看板が目印', 'JAの倉庫が左手', '踏切を越えて', '', '', '', 'コンビニが右角', 'T字路'];

/* ---- コースを組み立てる ---- */
const start = { lat: 42.9800, lon: 141.3600 };
let cur = { ...start }, heading = 90, cum = 0;
const pts = [{ ...start, ele: 12 }];
const turns = [];
const legCount = 48;

for (let i = 0; i < legCount; i++) {
  const lenM = Math.round(900 + rnd() * 6800);
  const step = 20;
  for (let d = step; d <= lenM; d += step) {
    const [la, lo] = destination(cur.lat, cur.lon, heading + (rnd() - 0.5) * 4, step);
    cum += haversine(cur.lat, cur.lon, la, lo);
    cur = { lat: la, lon: lo };
    pts.push({ lat: la, lon: lo, ele: Math.round(10 + 180 * Math.abs(Math.sin(cum / 24000))) });
  }
  if (i === legCount - 1) break;
  // 曲がる
  const kind = rnd();
  let delta;
  if (kind < 0.45) delta = 70 + rnd() * 40;        // 右折
  else if (kind < 0.9) delta = -(70 + rnd() * 40); // 左折
  else delta = (rnd() - 0.5) * 20;                 // ほぼ直進（橋・分岐など）
  const dir = delta > 40 ? '右折' : (delta < -40 ? '左折' : '直進');
  heading = (heading + delta + 360) % 360;
  turns.push({
    m: cum, dir,
    road: ROADS[Math.floor(rnd() * ROADS.length)] + ' → ' + ROADS[Math.floor(rnd() * ROADS.length)],
    landmark: LANDMARKS[Math.floor(rnd() * LANDMARKS.length)],
    signal: rnd() < 0.55 ? '有' : '無',
    lat: cur.lat, lon: cur.lon
  });
}
const gpxTotalKm = cum / 1000;
// キューシート側は実測がわずかに長い想定（補正係数の動作確認用）
const scale = 1.006;
const cueKm = m => Math.round(m / 1000 * scale * 10) / 10;

/* ---- CP ---- */
const totalKm = cueKm(cum);
const cpSpec = [
  { at: 0, kind: 'Start', name: 'デモ公園前', note: 'ブルベカードを受け取ってスタート' },
  { at: 0.14, kind: 'PC1', name: 'デモマート東町店', note: 'レシート取得後、直進で復帰' },
  { at: 0.33, kind: '通過C1', name: 'サンプル岬展望台', note: '看板と自転車を撮影' },
  { at: 0.55, kind: 'PC2', name: 'テストストア中央店', note: 'レシート取得後、右折で復帰' },
  { at: 0.78, kind: 'PC3', name: 'デモマート南町店', note: '夜間は照明を確認' },
  { at: 1.0, kind: 'Goal', name: 'デモ公園前', note: '受付でカード提出' }
];
const cps = cpSpec.map(s => {
  const m = s.at * cum;
  // 一番近い曲がり角の位置に寄せる（実際のキューシートに近い作り）
  const near = turns.reduce((b, t) => (Math.abs(t.m - m) < Math.abs(b.m - m) ? t : b), turns[0]);
  const mm = s.at === 0 ? 0 : (s.at === 1 ? cum : near.m);
  const km = cueKm(mm);
  const openMin = Math.max(0, Math.round(km / 34 * 60));
  const closeMin = s.at === 0 ? 30 : Math.round(km / 15 * 60);
  return { ...s, km, openMin, closeMin, lat: s.at === 0 ? start.lat : (s.at === 1 ? cur.lat : near.lat), lon: s.at === 0 ? start.lon : (s.at === 1 ? cur.lon : near.lon) };
});

/* ---- GPX 出力 ---- */
const wptXml = cps.filter(c => c.kind.startsWith('PC') || c.kind.startsWith('通過')).map(c => {
  // 店舗は道路からわずかに離れた位置にある想定
  const [la, lo] = destination(c.lat, c.lon, 30, 25);
  return `  <wpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}">
    <name>${c.kind}${c.name}</name>
    <cmt>convenience_store</cmt>
    <type>store</type>
  </wpt>`;
}).join('\n');

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="brevet-cuesheet demo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>デモBRM1010サンプル200km</name></metadata>
${wptXml}
  <trk><name>デモBRM1010サンプル200km</name><trkseg>
${pts.map(p => `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele}</ele></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>
`;
fs.writeFileSync(path.join(root, 'samples/demo.gpx'), gpx);

/* ---- Excel 出力（時刻はExcelシリアル値＝1日を1とする小数） ---- */
const START_MIN = 18 * 60; // 夜スタート（日跨ぎの動作確認）
const serial = minFromStart => (START_MIN + minFromStart) / 1440;

const simpleRows = [
  ['デモBRM1010サンプル200km　簡易キューシート'],
  [],
  ['No.', '種別', '地点名', '積算距離(km)', '区間距離(km)', 'Open', 'Close', '備考']
];
let prevKm = 0;
cps.forEach((c, i) => {
  simpleRows.push([i + 1, c.kind, c.name, c.km, Math.round((c.km - prevKm) * 10) / 10,
    serial(c.openMin), serial(c.closeMin), c.note]);
  prevKm = c.km;
});

const detailRows = [['No.', '進路', '積算距離(km)', '道路名', 'ランドマーク', '信号', '備考']];
let n = 0;
const merged = [
  ...turns.map(t => ({ type: 'turn', km: cueKm(t.m), t })),
  ...cps.map(c => ({ type: 'cp', km: c.km, c }))
].sort((a, b) => a.km - b.km);
merged.forEach(row => {
  if (row.type === 'turn') {
    detailRows.push([++n, row.t.dir, row.km, row.t.road, row.t.landmark, row.t.signal, '']);
  } else {
    detailRows.push(['', row.c.kind, row.km, row.c.name, '', '', row.c.note]);
  }
});

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet(simpleRows);
// 時刻セルに書式を設定
simpleRows.forEach((_, i) => {
  ['F', 'G'].forEach(col => {
    const ref = col + (i + 1);
    if (ws1[ref] && typeof ws1[ref].v === 'number' && i >= 3) { ws1[ref].t = 'n'; ws1[ref].z = 'hh:mm'; }
  });
});
XLSX.utils.book_append_sheet(wb, ws1, '簡易キューシート');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), '詳細キューシート');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync(path.join(root, 'samples/demo.xlsx'), buf);

/* ---- 区間距離しか載っていない形式（主催者によくある）のサンプル ----
   1シートに曲がり角とCPが混在し、見出しは「距離(km)」だけ。積算は無い。 */
const segRows = [['No.', '進路', '距離(km)', '道路名', 'ランドマーク', '信号', '備考']];
let prevKmSeg = 0, segNo = 0;
merged.forEach(row => {
  const km = row.type === 'turn' ? row.km : row.c.km;
  const seg = Math.round((km - prevKmSeg) * 10) / 10;
  prevKmSeg = km;
  if (row.type === 'turn') {
    segRows.push([++segNo, row.t.dir, seg, row.t.road, row.t.landmark, row.t.signal, '']);
  } else {
    segRows.push(['', row.c.kind, seg, row.c.name, '', '', row.c.note]);
  }
});
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(segRows), 'キューシート');
fs.writeFileSync(path.join(root, 'samples/demo-segment.xlsx'),
  XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
console.log(`区間距離版: ${segRows.length - 1}行 / 合計 ${prevKmSeg.toFixed(1)} km`);

/* ---- 見出しが2行に分かれ、CP名が道標欄にある形式（実際の主催者Excelの型） ---- */
const dayOf = min => 10 + Math.floor((START_MIN + min) / 1440);          // 開催日=10日
const hhmm = min => {
  const t = (START_MIN + min) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const mhRows = [
  [null, null, 'デモBRM1010サンプル200km', null, null, null, null, null, '2026年 10/10(土) 18:00スタート'],
  [' ', 'No.', '地点までの道路番号      ', '地点までの', null, '交差', '信号', '進路', '道標(青看板)の方向', 'ランドマーク・備考', 'open', 'close'],
  [' ', null, ' (R = 国道 ・ r =道道)', '区間', '積算', null, null, null, null, null, null, null]
];
let mhPrev = 0, mhNo = 0;
merged.forEach(row => {
  const km = row.type === 'turn' ? row.km : row.c.km;
  const seg = Math.round((km - mhPrev) * 10) / 10;
  mhPrev = km;
  if (row.type === 'turn') {
    mhRows.push([null, ++mhNo, row.t.road, seg, km, '┼', row.t.signal === '有' ? '〇' : '×',
      row.t.dir, row.t.landmark, '', null, null]);
  } else {
    const c = row.c;
    // 先頭のStartだけExcelシリアル値、以降は「10日 18:48」形式（実物と同じ混在）
    const o = c.at === 0 ? (START_MIN + c.openMin) / 1440 : `${dayOf(c.openMin)}日 ${hhmm(c.openMin)}`;
    const cl = c.at === 0 ? (START_MIN + c.closeMin) / 1440 : `${dayOf(c.closeMin)}日 ${hhmm(c.closeMin)}`;
    mhRows.push([null, ++mhNo, '', seg, km, '', '', '左側', `${c.kind} ${c.name}`, c.note, o, cl]);
  }
});
const wb3 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb3, XLSX.utils.aoa_to_sheet(mhRows), 'BRM1010デモ200km');
fs.writeFileSync(path.join(root, 'samples/demo-merged-header.xlsx'),
  XLSX.write(wb3, { type: 'buffer', bookType: 'xlsx' }));
console.log(`2行見出し版: ${mhRows.length - 3}行`);

/* ---- 進行方向が矢印記号で、時刻が備考欄の文中にある形式（別の主催者の型） ---- */
const arRows = [
  ['デモBRM1010サンプル200km', null, null, null, null, null, null, '2026年10月10日　18：00スタート　V1.0'],
  ['No.', '総距離', '区間距離', '進行方向', '交差点', '信号', '進行先の道路', '備考【青看板表示】']
];
const ARROW = { '右折': '→', '左折': '←', '直進': '↑' };
const CROSS = ['╋', '┫', '┻', '┃'];
let arPrev = 0, arNo = 0, arCross = 0;
merged.forEach(row => {
  const km = row.type === 'turn' ? row.km : row.c.km;
  const seg = Math.round((km - arPrev) * 10) / 10;
  arPrev = km;
  if (row.type === 'turn') {
    arRows.push([++arNo, km, seg, ARROW[row.t.dir] || '↑', CROSS[arCross++ % 4],
      row.t.signal === '有' ? '◎' : null, row.t.road, '【' + (row.t.landmark || '直進') + '】']);
  } else {
    const c = row.c;
    const label = c.kind === 'Start' ? 'START' : (c.kind === 'Goal' ? 'FINISH' : c.kind);
    const times = `OPEN ${hhmm(c.openMin).replace(':', '：')}/CLOSE ${hhmm(c.closeMin).replace(':', '：')}`;
    arRows.push([++arNo, km, seg, '↑', '┃', null, '',
      `左側　${label}  ${c.name}\r\nレシート取得　［参考 ${times}］`]);
  }
});
const wb4 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb4, XLSX.utils.aoa_to_sheet(arRows), 'Table 1');
fs.writeFileSync(path.join(root, 'samples/demo-arrow-notes.xlsx'),
  XLSX.write(wb4, { type: 'buffer', bookType: 'xlsx' }));
console.log(`矢印＋文中時刻版: ${arRows.length - 2}行`);

console.log(`GPX  : ${pts.length} trkpts / ${gpxTotalKm.toFixed(2)} km / wpt ${cps.filter(c=>c.kind!=='Start'&&c.kind!=='Goal').length}`);
console.log(`Excel: 簡易 ${cps.length} CP / 詳細 ${detailRows.length - 1} 行 / 総距離 ${totalKm} km`);
