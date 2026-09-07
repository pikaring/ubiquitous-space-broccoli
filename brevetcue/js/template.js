/* 出力HTMLテンプレート
   簡易版・詳細版を1ファイルに同梱した、オフライン動作の単一HTMLを生成する。
   ・データはJSONとしてインライン化し、閲覧時にJSで描画
   ・ダークモード対応（prefers-color-scheme）
   ・天気/地図パネルは「開いたときだけ」通信する */
(function (NS) {
  'use strict';

  /* ============================ CSS ============================ */
  function outputCss() {
    return `
* { box-sizing:border-box; margin:0; padding:0; }
:root {
  --bg-page:#f2f2f7; --bg-card:#ffffff; --bg-card-alt:#ececf0; --border-color:#d5d5da;
  --text-main:#000000; --text-sub:#6e6e73;
  --accent-red:#c0392b; --accent-blue:#0062cc; --accent-green:#1a7a3a;
  --accent-purple:#5856d6; --accent-gold:#96700a; --shadow:rgba(0,0,0,.10);
  --chip-fast-bg:#e8f4ff; --chip-ontime-bg:#e8fff0; --chip-slow-bg:#fff0f0; --chip-plain-bg:#f2f2f7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page:#000000; --bg-card:#1c1c1e; --bg-card-alt:#2c2c2e; --border-color:#48484a;
    --text-main:#ffffff; --text-sub:#aeaeb2;
    --accent-red:#ff6961; --accent-blue:#6ab7ff; --accent-green:#4cd971;
    --accent-purple:#ab9dff; --accent-gold:#ffcf4d; --shadow:rgba(0,0,0,.6);
    --chip-fast-bg:#10314d; --chip-ontime-bg:#0f3a1f; --chip-slow-bg:#4a1512; --chip-plain-bg:#2c2c2e;
  }
}
body { font-family:-apple-system,'Hiragino Sans','Yu Gothic',sans-serif; background:var(--bg-page); color:var(--text-main); min-height:100vh; -webkit-text-size-adjust:100%; }
header { background:var(--bg-card); border-bottom:1px solid var(--border-color); padding:14px 16px; position:sticky; top:0; z-index:100; display:flex; align-items:center; gap:12px; }
header .icon { font-size:24px; color:var(--accent-red); flex-shrink:0; }
header h1 { font-size:17px; font-weight:700; line-height:1.3; }
nav { background:var(--bg-card); border-bottom:1px solid var(--border-color); display:flex; position:sticky; top:53px; z-index:99; }
nav button { flex:1; padding:12px 8px; font-size:15px; font-weight:600; color:var(--text-sub); background:none; border:none; border-bottom:3px solid transparent; cursor:pointer; font-family:inherit; }
nav button.active { color:var(--accent-red); border-bottom-color:var(--accent-red); font-weight:700; }
main { padding:10px; max-width:820px; margin:0 auto; }
.view { display:none; }
.view.active { display:block; }

/* ===== 設定バー ===== */
.settings { background:var(--bg-card); border-radius:14px; padding:12px 14px; margin-bottom:10px; box-shadow:0 1px 5px var(--shadow); }
.settings + .settings { margin-top:-2px; }
.settings-title { font-size:13px; color:var(--text-sub); font-weight:700; margin-bottom:8px; }
.settings-row { display:flex; align-items:center; gap:8px; justify-content:center; flex-wrap:wrap; }
.stepper-btn { border:none; border-radius:10px; background:var(--bg-card-alt); color:var(--text-main); font-size:16px; font-weight:700; padding:10px 12px; cursor:pointer; -webkit-tap-highlight-color:transparent; min-width:50px; font-family:inherit; }
.stepper-btn.big { background:var(--accent-red); color:#fff; }
.stepper-btn:active { opacity:.7; }
.stepper-display { font-size:21px; font-weight:800; min-width:96px; text-align:center; }
.link-btn { border:none; background:none; color:var(--text-sub); font-size:13px; text-decoration:underline; padding:4px; cursor:pointer; font-family:inherit; }
input[type=date], input[type=time] { background:var(--bg-card-alt); color:var(--text-main); border:1px solid var(--border-color); font-size:16px; padding:8px; border-radius:8px; font-family:inherit; }

/* ===== 簡易版：総距離バナー ===== */
.total-banner { background:linear-gradient(135deg,#8b1a1a 0%,#c0392b 60%,#6b0f0f 100%); border-radius:16px; padding:14px 18px; color:#fff; margin-bottom:10px; box-shadow:0 2px 8px rgba(139,26,26,.35); }
.banner-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
.banner-left .event-name { font-size:12px; font-weight:700; opacity:.95; margin-bottom:4px; }
.banner-left .total-label { font-size:11px; opacity:.75; }
.banner-left .value { font-size:26px; font-weight:800; }
.banner-left .unit { font-size:13px; opacity:.85; }
.banner-left .sub { font-size:11px; opacity:.85; margin-top:2px; }
.banner-right { text-align:right; flex-shrink:0; }
.banner-right .label { font-size:12px; opacity:.85; }
.banner-right .start-time { font-size:20px; font-weight:700; }
.banner-right .sub { font-size:11px; opacity:.8; margin-top:2px; }

/* ===== 簡易版：CPリスト ===== */
.card { background:var(--bg-card); border-radius:16px; overflow:hidden; box-shadow:0 1px 4px var(--shadow); margin-bottom:12px; }
.legend { display:flex; gap:10px; flex-wrap:wrap; padding:10px 16px; border-bottom:1px solid var(--border-color); font-size:11px; color:var(--text-sub); }
.legend-item { display:flex; align-items:center; gap:4px; }
.legend-dot { width:10px; height:10px; border-radius:50%; }
.cp-item { border-bottom:1px solid var(--border-color); }
.cp-item:last-child { border-bottom:none; }
.cp-head { display:flex; align-items:center; justify-content:space-between; padding:13px 16px 5px; cursor:pointer; gap:8px; }
.cp-title { font-size:15px; font-weight:700; flex:1; }
.chevron { font-size:16px; color:var(--text-sub); transition:transform .2s; }
.chevron.open { transform:rotate(180deg); }
.cp-meta { display:flex; align-items:center; gap:7px; padding:0 16px 11px; flex-wrap:wrap; }
.badge { display:inline-flex; align-items:center; gap:3px; padding:3px 9px; border-radius:20px; font-size:11px; font-weight:700; color:#fff; white-space:nowrap; }
.badge-start,.badge-goal { background:#34c759; }
.badge-pc { background:#ff3b30; }
.badge-pass,.badge-quiz { background:#5856d6; }
.dist-text { font-size:13px; color:var(--text-sub); font-weight:600; white-space:nowrap; }
.dist-text .unit { font-size:11px; }
.seg-text { font-size:11px; color:var(--text-sub); opacity:.8; white-space:nowrap; }
.time-row { display:flex; gap:5px; align-items:center; flex-wrap:wrap; }
.time-chip { display:inline-flex; flex-direction:column; align-items:center; padding:3px 9px; border-radius:10px; font-size:13px; font-weight:700; white-space:nowrap; line-height:1.2; }
.time-chip .chip-label { font-size:9px; font-weight:500; opacity:.75; margin-bottom:1px; }
.chip-open { background:var(--chip-fast-bg); color:var(--accent-blue); }
.chip-close { background:var(--chip-slow-bg); color:var(--accent-red); }
.chip-eta { background:var(--chip-plain-bg); color:var(--text-sub); }
.chip-eta.fast { background:var(--chip-fast-bg); color:var(--accent-blue); }
.chip-eta.ontime { background:var(--chip-ontime-bg); color:var(--accent-green); }
.chip-eta.slow { background:var(--chip-slow-bg); color:var(--accent-red); }
.chip-rest { background:var(--chip-plain-bg); color:var(--accent-gold); }
.cp-detail { background:var(--bg-card-alt); padding:10px 16px 14px; border-top:1px solid var(--border-color); font-size:13px; color:var(--text-main); line-height:1.7; display:none; }
.cp-detail.open { display:block; }
.rest-row { display:flex; align-items:center; gap:6px; margin-top:8px; flex-wrap:wrap; }
.rest-row .rest-label { font-size:12px; color:var(--text-sub); }
.rest-btn { border:none; border-radius:8px; background:var(--bg-card); color:var(--text-main); border:1px solid var(--border-color); font-size:13px; font-weight:700; padding:6px 10px; cursor:pointer; font-family:inherit; }
.rest-val { font-size:15px; font-weight:800; min-width:56px; text-align:center; }
.info-tip { margin-top:8px; background:var(--bg-card); border-radius:8px; padding:8px 10px; font-size:12px; border-left:3px solid var(--accent-red); }
.photo-tip { margin-top:8px; background:var(--bg-card); border-radius:8px; padding:8px 10px; font-size:12px; border-left:3px solid var(--accent-purple); }

/* ===== 詳細版 ===== */
.section-header { display:flex; align-items:center; gap:8px; padding:12px 4px 6px; font-size:14px; font-weight:800; color:var(--text-sub); letter-spacing:.5px; }
.section-line { flex:1; height:1px; background:var(--border-color); }
.turn-row { background:var(--bg-card); border-radius:14px; margin-bottom:8px; overflow:hidden; box-shadow:0 1px 4px var(--shadow); }
.turn-main { display:flex; align-items:stretch; }
.turn-side { width:64px; flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:12px 4px; background:var(--bg-card-alt); border-right:1px solid var(--border-color); }
.turn-arrow { font-size:32px; line-height:1; font-weight:700; color:var(--text-main); }
.turn-signal { font-size:12px; margin-top:5px; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; }
.sig-green { background:var(--accent-green); color:#fff; }
.sig-none { background:var(--border-color); color:var(--text-sub); }
.turn-body { flex:1; padding:14px 16px; min-width:0; }
.turn-top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.turn-place,.turn-road,.turn-landmark,.cp-name-detail,.cp-note,.cp-photo { font-size:22px; font-weight:700; color:var(--text-main); line-height:1.35; }
.turn-place { flex:1; }
.turn-road { margin-top:6px; }
.turn-landmark { margin-top:8px; }
.turn-dist { font-size:15px; color:var(--text-sub); white-space:nowrap; flex-shrink:0; text-align:right; font-weight:600; }
.turn-dist .km { font-size:24px; font-weight:800; color:var(--text-main); }
.cp-row { background:var(--bg-card); border-radius:14px; margin-bottom:10px; padding:14px 16px 4px; box-shadow:0 2px 6px var(--shadow); border-left:6px solid var(--accent-red); }
.cp-row.k-pass,.cp-row.k-quiz { border-left-color:var(--accent-purple); }
.cp-row.k-goal,.cp-row.k-start { border-left-color:var(--accent-green); }
.cp-row-top { display:flex; align-items:center; gap:8px; justify-content:space-between; }
.cp-badge { display:inline-flex; align-items:center; gap:4px; padding:6px 14px; border-radius:20px; font-size:16px; font-weight:700; color:#fff; white-space:nowrap; }
.cp-badge.k-pc { background:var(--accent-red); }
.cp-badge.k-pass,.cp-badge.k-quiz { background:var(--accent-purple); }
.cp-badge.k-start,.cp-badge.k-goal { background:var(--accent-green); }
.cp-km { font-size:26px; font-weight:800; }
.cp-km span { font-size:16px; opacity:.8; font-weight:600; }
.cp-name-detail { margin-top:8px; }
.cp-times { display:flex; gap:10px; margin-top:10px; flex-wrap:wrap; }
.cp-time-chip { display:inline-flex; flex-direction:column; align-items:center; padding:6px 14px; border-radius:10px; font-size:19px; font-weight:800; white-space:nowrap; line-height:1.2; color:#fff; }
.cp-time-chip .tl { font-size:12px; opacity:.85; margin-bottom:1px; font-weight:600; }
.chip-open2 { background:var(--accent-blue); }
.chip-close2 { background:var(--accent-red); }
.cp-note { margin-top:10px; }
.cp-photo { margin-top:8px; border-left:4px solid var(--accent-purple); padding-left:10px; }

/* ===== 天気・地図パネル ===== */
.wx-toggle-row { padding:10px 14px 12px; }
.wx-toggle-btn { width:100%; border:none; border-radius:10px; background:var(--bg-card-alt); color:var(--accent-blue); font-size:16px; font-weight:700; padding:11px; cursor:pointer; font-family:inherit; -webkit-tap-highlight-color:transparent; }
.wx-toggle-btn.active { background:var(--accent-blue); color:#fff; }
.wx-panel { display:none; padding:0 14px 14px; }
.wx-panel.open { display:block; }
.wx-loading { font-size:15px; color:var(--text-sub); padding:10px 0; text-align:center; }
.wx-error { font-size:15px; color:var(--accent-red); padding:10px 0; text-align:center; font-weight:700; }
.wx-weather-card { background:var(--bg-card-alt); border-radius:12px; padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; gap:14px; }
.wx-wind-arrow { flex-shrink:0; display:flex; flex-direction:column; align-items:center; }
.wx-wind-arrow .arrow-icon { font-size:30px; line-height:1; }
.wx-wind-arrow .arrow-label { font-size:12px; font-weight:700; margin-top:2px; }
.wx-wind-arrow.headwind .arrow-icon,.wx-wind-arrow.headwind .arrow-label { color:var(--accent-red); }
.wx-wind-arrow.tailwind .arrow-icon,.wx-wind-arrow.tailwind .arrow-label { color:var(--accent-green); }
.wx-wind-arrow.crosswind .arrow-icon,.wx-wind-arrow.crosswind .arrow-label { color:var(--accent-gold); }
.wx-details { flex:1; display:flex; flex-wrap:wrap; gap:10px 16px; }
.wx-item { display:flex; flex-direction:column; }
.wx-item .wx-label { font-size:12px; color:var(--text-sub); font-weight:600; }
.wx-item .wx-value { font-size:19px; font-weight:800; }
.wx-item .wx-value.rain-warn { color:var(--accent-blue); }
.wx-map-frame { width:100%; height:220px; border-radius:12px; overflow:hidden; border:1px solid var(--border-color); }
.wx-map-frame iframe { width:100%; height:100%; border:none; }
.wx-map-link { display:block; text-align:center; font-size:15px; color:var(--accent-blue); margin-top:8px; font-weight:700; }
.wx-static-map { position:relative; overflow:hidden; border-radius:12px; border:1px solid var(--border-color); margin:0 auto; max-width:100%; }
.wx-static-map img { position:absolute; width:256px; height:256px; }
.wx-static-pin { position:absolute; left:50%; top:50%; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; background:#ff3b30; border:3px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.35); }
.wx-attr { font-size:11px; color:var(--text-sub); text-align:center; margin-top:5px; }
.wx-sketch { position:relative; overflow:hidden; border-radius:12px; border:1px solid var(--border-color); margin:0 auto; background:var(--bg-card-alt); max-width:100%; }
.wx-sketch-svg { position:absolute; left:0; top:0; }
.rt-outline { fill:none; stroke:#fff; stroke-width:7; stroke-linecap:round; stroke-linejoin:round; opacity:.9; }
.rt-in { fill:none; stroke:#8e8e93; stroke-width:3.5; stroke-linecap:round; stroke-linejoin:round; }
.rt-out { fill:none; stroke:#ff3b30; stroke-width:3.5; stroke-linecap:round; stroke-linejoin:round; }
.rt-arrow { fill:#ff3b30; stroke:#fff; stroke-width:1.2; }
.rt-north { fill:var(--text-sub); font-size:11px; font-weight:700; }
.rt-scale line { stroke:var(--text-main); stroke-width:1.5; opacity:.75; }
.rt-scale text { fill:var(--text-main); font-size:10px; font-weight:700; opacity:.85; }
.wx-stamp { font-size:11px; color:var(--text-sub); text-align:center; margin:-4px 0 8px; }
@media (prefers-color-scheme: dark) { .wx-static-map img { filter:invert(.92) hue-rotate(180deg) brightness(1.05) contrast(.95); } }
.wx-map-tap { display:block; text-decoration:none; color:inherit; -webkit-tap-highlight-color:transparent; }
.wx-map-tap:active .wx-static-map, .wx-map-tap:active .wx-sketch { opacity:.75; }
.wx-outofrange { font-size:14px; color:var(--accent-gold); background:var(--bg-card-alt); border-radius:10px; padding:12px; text-align:center; font-weight:700; margin-bottom:10px; line-height:1.5; }
.wx-net-note { font-size:13px; color:var(--accent-gold); background:var(--bg-card-alt); border-radius:10px; padding:10px 12px; margin-top:8px; font-weight:600; line-height:1.5; }
.wx-error .wx-sub { display:block; margin-top:5px; font-size:12px; font-weight:600; color:var(--text-sub); }
.wx-retry { border:none; border-radius:8px; background:var(--accent-blue); color:#fff; font-size:14px; font-weight:700; padding:8px 18px; cursor:pointer; font-family:inherit; }
@media (prefers-color-scheme: dark) {
  .wx-map-frame iframe { filter:invert(.92) hue-rotate(180deg) brightness(1.05) contrast(.95); }
}
.gen-notice { background:var(--chip-slow-bg); border-left:5px solid var(--accent-red); border-radius:10px; padding:11px 14px; margin-bottom:10px; font-size:13px; line-height:1.6; color:var(--text-main); }
.gen-notice b { color:var(--accent-red); }
.gen-notice ul { margin:4px 0 0 18px; }
.footer-note { font-size:11px; color:var(--text-sub); text-align:center; padding:16px 8px 32px; line-height:1.6; }
@media print {
  nav, .settings, .wx-toggle-row, .wx-panel, .chevron { display:none !important; }
  body { background:#fff; }
  .cp-detail { display:block !important; }
  .turn-row, .cp-row, .card { box-shadow:none; border:1px solid #ccc; break-inside:avoid; }
}
`;
  }

  /* ==================== 出力HTML内で動くランタイム ==================== */
  /* この関数はソースのまま出力HTMLへ埋め込まれる（toString） */
  function runtime() {
    var DATA = window.__COURSE__;
    var S = {
      speed: DATA.meta.defaultSpeed || 18,
      offsetKm: 0,
      startDate: DATA.meta.startDate,   // 'YYYY-MM-DD'
      startTime: DATA.meta.startTime,   // 'HH:MM'
      rests: {},                        // CPインデックス → 休憩(分)
      openDetails: {}
    };
    var LS_KEY = 'brevet-cue:' + (DATA.meta.id || DATA.meta.title);

    function saveState() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          speed: S.speed, offsetKm: S.offsetKm, startDate: S.startDate, startTime: S.startTime, rests: S.rests
        }));
      } catch (e) { /* プライベートモード等では保存しない */ }
    }
    function loadState() {
      try {
        var raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        var o = JSON.parse(raw);
        if (o.speed) S.speed = o.speed;
        if (typeof o.offsetKm === 'number') S.offsetKm = o.offsetKm;
        if (o.startDate) S.startDate = o.startDate;
        if (o.startTime) S.startTime = o.startTime;
        if (o.rests) S.rests = o.rests;
      } catch (e) { /* 壊れていたら初期値で続行 */ }
    }

    function pad2(n) { return String(n).padStart(2, '0'); }
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function startMinOfDay() {
      var p = (S.startTime || '07:00').split(':');
      return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    }
    function fmtClock(minFromStart) {
      if (minFromStart == null || !isFinite(minFromStart)) return '—';
      var abs = startMinOfDay() + Math.round(minFromStart);
      var day = Math.floor(abs / 1440);
      var r = ((abs % 1440) + 1440) % 1440;
      var prefix = day <= 0 ? '' : (day === 1 ? '翌' : (day + 1) + '日目 ');
      return prefix + pad2(Math.floor(r / 60)) + ':' + pad2(r % 60);
    }
    function fmtDur(min) {
      var h = Math.floor(min / 60), m = min % 60;
      return h + ':' + pad2(m);
    }
    function startDateTime() {
      if (!S.startDate) return null;
      return new Date(S.startDate + 'T' + (S.startTime || '07:00') + ':00');
    }
    function dispDist(km) { return (km + S.offsetKm).toFixed(1); }

    /* ---- ETA（休憩の累積を加味） ---- */
    function etaMin(cpIndex) {
      var cp = DATA.cps[cpIndex];
      var rest = 0;
      for (var i = 0; i < cpIndex; i++) rest += (S.rests[i] || 0);
      return (cp.distKm / S.speed) * 60 + rest;
    }
    function etaMinForDist(km) {
      var rest = 0;
      for (var i = 0; i < DATA.cps.length; i++) {
        if (DATA.cps[i].distKm < km) rest += (S.rests[i] || 0); else break;
      }
      return (km / S.speed) * 60 + rest;
    }

    /* ---- 日出・日没 ---- */
    function sunTimes(lat, lon, date) {
      function toRad(d) { return d * Math.PI / 180; }
      function toDeg(r) { return r * 180 / Math.PI; }
      var start = Date.UTC(date.getFullYear(), 0, 0);
      var n = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
      function calc(isSunrise) {
        var lngHour = lon / 15;
        var t = n + ((isSunrise ? 6 : 18) - lngHour) / 24;
        var M = (0.9856 * t) - 3.289;
        var L = (M + (1.916 * Math.sin(toRad(M))) + (0.020 * Math.sin(toRad(2 * M))) + 282.634 + 360) % 360;
        var RA = (toDeg(Math.atan(0.91764 * Math.tan(toRad(L)))) + 360) % 360;
        RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
        var sinDec = 0.39782 * Math.sin(toRad(L));
        var cosDec = Math.cos(Math.asin(sinDec));
        var cosH = (Math.cos(toRad(90.833)) - (sinDec * Math.sin(toRad(lat)))) / (cosDec * Math.cos(toRad(lat)));
        if (cosH > 1 || cosH < -1) return null;
        var H = (isSunrise ? (360 - toDeg(Math.acos(cosH))) : toDeg(Math.acos(cosH))) / 15;
        var T = H + RA - (0.06571 * t) - 6.622;
        var UT = ((T - lngHour) % 24 + 24) % 24;
        var tz = -new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTimezoneOffset();
        return (Math.round(UT * 60 + tz) % 1440 + 1440) % 1440;
      }
      return { sunrise: calc(true), sunset: calc(false) };
    }

    /* ================= 描画 ================= */
    var KIND_BADGE = {
      start: { cls: 'badge-start', text: 'Start' },
      goal: { cls: 'badge-goal', text: '🏁 Goal' },
      pc: { cls: 'badge-pc', text: '🏪 ' },
      pass: { cls: 'badge-pass', text: '📷 ' },
      quiz: { cls: 'badge-quiz', text: '❓ ' }
    };
    var ARROWS = {
      right: '→', left: '←', straight: '↑', uturn: '⤶',
      'slight-right': '↗', 'slight-left': '↖', 'sharp-right': '⤳', 'sharp-left': '⤺'
    };
    var DIR_LABEL = {
      right: '右折', left: '左折', straight: '直進', uturn: 'Uターン',
      'slight-right': '斜め右', 'slight-left': '斜め左', 'sharp-right': '鋭角右折', 'sharp-left': '鋭角左折'
    };

    function badgeHtml(cp) {
      var b = KIND_BADGE[cp.kind] || { cls: 'badge-pc', text: '' };
      var text = (cp.kind === 'pc' || cp.kind === 'pass' || cp.kind === 'quiz')
        ? b.text + (cp.label || '') : b.text;
      return '<span class="badge ' + b.cls + '">' + esc(text) + '</span>';
    }

    function renderSimple() {
      var host = document.getElementById('cp-list');
      var html = '';
      DATA.cps.forEach(function (cp, i) {
        var rest = S.rests[i] || 0;
        html += '<div class="cp-item" data-i="' + i + '">' +
          '<div class="cp-head" data-toggle="' + i + '">' +
            '<span class="cp-title">' + esc((cp.label && cp.kind !== 'start' && cp.kind !== 'goal' ? cp.label + '　' : '') + (cp.name || cp.label || '')) + '</span>' +
            '<span class="chevron' + (S.openDetails[i] ? ' open' : '') + '">﹀</span>' +
          '</div>' +
          '<div class="cp-meta">' +
            badgeHtml(cp) +
            '<span class="dist-text"><span class="dist-val">' + dispDist(cp.distKm) + '</span> <span class="unit">KM</span></span>' +
            (cp.segKm ? '<span class="seg-text">区間 ' + cp.segKm.toFixed(1) + 'km</span>' : '') +
            '<div class="time-row">' +
              (cp.openMin != null ? '<span class="time-chip chip-open"><span class="chip-label">Open</span>' + fmtClock(cp.openMin) + '</span>' : '') +
              (cp.closeMin != null ? '<span class="time-chip chip-close"><span class="chip-label">Close</span>' + fmtClock(cp.closeMin) + '</span>' : '') +
              (cp.distKm > 0 ? '<span class="time-chip chip-eta" data-eta="' + i + '"><span class="chip-label">ETA</span><span class="eta-time">—</span></span>' : '') +
              (rest > 0 ? '<span class="time-chip chip-rest"><span class="chip-label">休憩</span>' + fmtDur(rest) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="cp-detail' + (S.openDetails[i] ? ' open' : '') + '">' +
            (cp.road ? esc(cp.road) + '<br>' : '') +
            (cp.landmark ? esc(cp.landmark) + '<br>' : '') +
            (cp.note ? '<div class="info-tip">' + esc(cp.note) + '</div>' : '') +
            (cp.kind === 'pass' ? '<div class="photo-tip">📸 目標物と自転車（またはブルベカード）を撮影してルート復帰</div>' : '') +
            (cp.kind === 'quiz' ? '<div class="photo-tip">❓ 設問に回答してからルート復帰</div>' : '') +
            '<div class="rest-row">' +
              '<span class="rest-label">🛌 ここでの休憩・仮眠</span>' +
              '<button class="rest-btn" data-rest="' + i + '" data-delta="-30">−30分</button>' +
              '<span class="rest-val" data-restval="' + i + '">' + fmtDur(rest) + '</span>' +
              '<button class="rest-btn" data-rest="' + i + '" data-delta="30">+30分</button>' +
              '<button class="rest-btn" data-rest="' + i + '" data-delta="180">+3時間</button>' +
              '<button class="rest-btn" data-rest="' + i + '" data-delta="-1440">リセット</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      host.innerHTML = html;

      host.querySelectorAll('[data-toggle]').forEach(function (el) {
        el.addEventListener('click', function () {
          var i = el.dataset.toggle;
          var item = el.closest('.cp-item');
          var d = item.querySelector('.cp-detail');
          var open = d.classList.toggle('open');
          el.querySelector('.chevron').classList.toggle('open', open);
          S.openDetails[i] = open;
        });
      });
      host.querySelectorAll('[data-rest]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var i = btn.dataset.rest, d = parseInt(btn.dataset.delta, 10);
          var cur = S.rests[i] || 0;
          var next = (d === -1440) ? 0 : Math.max(0, Math.min(1440, cur + d));
          S.rests[i] = next;
          saveState();
          renderSimple();
          updateAll();
        });
      });
    }

    function renderDetail() {
      var host = document.getElementById('cue-list');
      var html = '';
      DATA.cues.forEach(function (c, i) {
        var uid = 'q' + i;
        var wx = '<div class="wx-toggle-row"><button class="wx-toggle-btn" data-wx="' + uid + '">🌤 天気・地図</button></div>' +
                 '<div class="wx-panel" id="wx-' + uid + '" data-uid="' + uid + '" data-lat="' + c.lat + '" data-lon="' + c.lon + '" data-brg="' + (c.bearing || 0) + '" data-dist="' + c.distKm + '"></div>';
        if (c.kind === 'turn') {
          var sig = c.signal === true ? '<div class="turn-signal sig-green">●</div>'
                  : (c.signal === false ? '<div class="turn-signal sig-none">×</div>' : '');
          html += '<div class="turn-row">' +
            '<div class="turn-main">' +
              '<div class="turn-side"><div class="turn-arrow">' + (ARROWS[c.direction] || '↑') + '</div>' + sig + '</div>' +
              '<div class="turn-body">' +
                '<div class="turn-top">' +
                  '<span class="turn-place">No.' + c.no + '　' + esc(c.directionText || DIR_LABEL[c.direction] || '') + '</span>' +
                  '<span class="turn-dist"><span class="km dist-val" data-base="' + c.distKm + '">' + dispDist(c.distKm) + '</span> km</span>' +
                '</div>' +
                (c.road ? '<div class="turn-road">' + esc(c.road) + '</div>' : '') +
                (c.name && !c.road ? '<div class="turn-road">' + esc(c.name) + '</div>' : '') +
                (c.sign ? '<div class="turn-landmark">道標「' + esc(c.sign) + '」</div>' : '') +
                (c.landmark ? '<div class="turn-landmark">' + esc(c.landmark) + '</div>' : '') +
                (c.note ? '<div class="turn-landmark">' + esc(c.note) + '</div>' : '') +
              '</div>' +
            '</div>' + wx +
          '</div>';
        } else {
          var b = KIND_BADGE[c.kind] || { cls: '', text: '' };
          var badgeText = (c.kind === 'pc' || c.kind === 'pass' || c.kind === 'quiz') ? b.text + (c.label || '') : b.text;
          html += '<div class="cp-row k-' + c.kind + '">' +
            '<div class="cp-row-top">' +
              '<span class="cp-badge k-' + c.kind + '">' + esc(badgeText) + '</span>' +
              '<span class="cp-km"><span class="dist-val" data-base="' + c.distKm + '">' + dispDist(c.distKm) + '</span><span> KM</span></span>' +
            '</div>' +
            '<div class="cp-name-detail">' + esc(c.name || '') + '</div>' +
            '<div class="cp-times">' +
              (c.openMin != null ? '<span class="cp-time-chip chip-open2"><span class="tl">Open</span>' + fmtClock(c.openMin) + '</span>' : '') +
              (c.closeMin != null ? '<span class="cp-time-chip chip-close2"><span class="tl">Close</span>' + fmtClock(c.closeMin) + '</span>' : '') +
            '</div>' +
            (c.road ? '<div class="cp-note">' + esc(c.road) + '</div>' : '') +
            (c.landmark ? '<div class="cp-note">' + esc(c.landmark) + '</div>' : '') +
            (c.note ? '<div class="cp-note">' + esc(c.note) + '</div>' : '') +
            (c.kind === 'pass' ? '<div class="cp-photo">📸 目標物と自転車を撮影</div>' : '') +
            wx +
          '</div>';
        }
      });
      host.innerHTML = html;
      host.querySelectorAll('[data-wx]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleWx(btn, btn.dataset.wx); });
      });
    }

    /* ---- 表示の更新（距離補正・ETA・時刻） ---- */
    function updateAll() {
      document.getElementById('speed-display').textContent = S.speed + ' km/h';
      var sign = S.offsetKm > 0 ? '+' : (S.offsetKm < 0 ? '' : '±');
      document.getElementById('offset-display').textContent = sign + S.offsetKm.toFixed(1) + ' km';
      document.querySelectorAll('#cue-list .dist-val').forEach(function (el) {
        el.textContent = (parseFloat(el.dataset.base) + S.offsetKm).toFixed(1);
      });
      document.querySelectorAll('#cp-list .cp-item').forEach(function (item) {
        var i = parseInt(item.dataset.i, 10);
        var cp = DATA.cps[i];
        var dv = item.querySelector('.dist-val');
        if (dv) dv.textContent = dispDist(cp.distKm);
        var chip = item.querySelector('[data-eta]');
        if (!chip) return;
        var eta = etaMin(i);
        chip.querySelector('.eta-time').textContent = fmtClock(eta);
        chip.classList.remove('fast', 'ontime', 'slow');
        if (cp.closeMin != null) {
          var margin = cp.closeMin - eta;
          chip.classList.add(margin > 120 ? 'fast' : (margin >= 30 ? 'ontime' : 'slow'));
        }
      });
      // バナー
      document.getElementById('banner-total').textContent = (DATA.meta.totalKm + S.offsetKm).toFixed(1);
      document.getElementById('banner-start').textContent = S.startTime || '--:--';
      var d = startDateTime();
      document.getElementById('banner-date').textContent = d
        ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + '日月火水木金土'[d.getDay()] + '）'
        : '出走日未設定';
      var goal = DATA.cps[DATA.cps.length - 1];
      document.getElementById('banner-goalclose').textContent =
        goal && goal.closeMin != null ? 'GOAL Close ' + fmtClock(goal.closeMin) : '';
      var sunEl = document.getElementById('banner-sun');
      if (d && DATA.meta.startLat != null) {
        var st = sunTimes(DATA.meta.startLat, DATA.meta.startLon, d);
        sunEl.textContent = (st.sunrise != null)
          ? '日出' + pad2(Math.floor(st.sunrise / 60)) + ':' + pad2(st.sunrise % 60) +
            '　日没' + pad2(Math.floor(st.sunset / 60)) + ':' + pad2(st.sunset % 60) : '';
      } else { sunEl.textContent = ''; }
      // ETA合計（走行時間＋休憩）
      var totalRest = 0;
      Object.keys(S.rests).forEach(function (k) { totalRest += S.rests[k] || 0; });
      document.getElementById('banner-est').textContent =
        '想定所要 ' + fmtDur(Math.round((DATA.meta.totalKm / S.speed) * 60 + totalRest)) +
        (totalRest ? '（休憩' + fmtDur(totalRest) + '含む）' : '');
      saveState();
    }

    /* ---- 天気・地図 ---- */
    var wxCache = {};
    function bearingToCompass(deg) {
      var dirs = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
      return dirs[Math.round(deg / 22.5) % 16];
    }
    function windRelation(routeBrg, windFromDeg) {
      var windTo = (windFromDeg + 180) % 360;
      var diff = Math.abs(routeBrg - windTo);
      if (diff > 180) diff = 360 - diff;
      if (diff <= 45) return 'tailwind';
      if (diff >= 135) return 'headwind';
      return 'crosswind';
    }
    function relationLabel(rel) {
      if (rel === 'tailwind') return { icon: '↓', label: '追い風' };
      if (rel === 'headwind') return { icon: '↑', label: '向かい風' };
      return { icon: '→', label: '横風' };
    }
    function toggleWx(btn, uid) {
      var panel = document.getElementById('wx-' + uid);
      var open = panel.classList.toggle('open');
      btn.classList.toggle('active', open);
      if (open && !panel.dataset.loaded) {
        panel.dataset.loaded = '1';
        loadWx(panel);
      }
    }
    function fmtDateTime(d) {
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    /* このページがどう開かれているか。
       iOSのChrome/Edgeはローカルファイルを chrome://external-file・edge://external-file という
       内部スキームで開き、そこからの外部通信（fetch・iframe）を一律ブロックする。
       このときは待たずに理由を出す。 */
    function scheme() {
      var over = window.__CUE_SCHEME__;                     // 動作確認用の上書き
      if (over === 'web' || over === 'file' || over === 'app') return over;
      // blob:http://… （生成ツールのプレビュー）は中身のスキームで判定する
      var href = location.href.replace(/^blob:/, '');
      if (/^https?:/i.test(href)) return 'web';
      if (/^file:/i.test(href)) return 'file';
      return 'app';
    }

    function localSchemeNote() {
      return 'このページは端末内のファイル（' + esc(location.protocol) + '）として開かれています。' +
        'iOSのChrome／Edgeはこの状態での外部通信を禁止しているため、天気と地図は表示できません。' +
        'オンラインのURLから開くと表示されます（キューシートの表示・ETA・距離補正はこのままで使えます）。';
    }

    /* 通信できなかった理由の見立て */
    function netHint(err) {
      if (scheme() === 'app') return localSchemeNote();
      if (navigator.onLine === false) return 'この端末は現在オフラインです。';
      var tail = (scheme() === 'file')
        ? 'ローカルファイルとして開いているため、ブラウザ側で外部通信が制限されている可能性もあります。' : '';
      if (err && err.name === 'AbortError') {
        return '応答がありませんでした（タイムアウト）。組織のプロキシ／フィルタでブロックされている可能性があります。' + tail;
      }
      return 'オフラインか、組織のプロキシ／フィルタでブロックされている可能性があります。' + tail;
    }

    /* 地図・略図をタップしたらGoogleマップを開く（iOSではマップアプリが起動する） */
    function gmapUrl(lat, lon) {
      return 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon;
    }
    function tapWrap(lat, lon, inner) {
      return '<a class="wx-map-tap" href="' + gmapUrl(lat, lon) + '" target="_blank" rel="noopener">' + inner + '</a>';
    }
    function fetchWithTimeout(url, ms, opt) {
      var ctl = new AbortController();
      var id = setTimeout(function () { ctl.abort(); }, ms);
      var o = opt || {};
      o.signal = ctl.signal;
      return fetch(url, o).then(
        function (r) { clearTimeout(id); return r; },
        function (e) { clearTimeout(id); throw e; }
      );
    }

    /* 生成時に焼き込んだデータ（オフライン用） */
    function offlineMap() { return DATA.offline && DATA.offline.map; }
    function offlineWx() { return DATA.offline && DATA.offline.wx; }

    /** GPXの線形から起こしたルート略図（SVG・通信不要・数百バイト）
     *  fit=true で枠に収まるよう拡大縮小する（タイルに重ねるときは等倍のまま） */
    function sketchSvg(uid, W, H, lat, fit) {
      var sk = DATA.offline && DATA.offline.sketch;
      if (!sk || !sk.paths || !sk.paths[uid]) return '';
      var pts = sk.paths[uid];
      if (pts.length < 2) return '';

      var k = 1;
      if (fit) {
        var mx = 0, my = 0;
        pts.forEach(function (p) { mx = Math.max(mx, Math.abs(p[0])); my = Math.max(my, Math.abs(p[1])); });
        k = Math.min((W / 2 - 14) / (mx || 1), (H / 2 - 14) / (my || 1));
        k = Math.max(0.15, Math.min(k, 3));
      }
      var ci = 0, best = Infinity;
      pts.forEach(function (p, i) {
        var d = p[0] * p[0] + p[1] * p[1];
        if (d < best) { best = d; ci = i; }
      });
      function path(list) {
        return list.map(function (p, i) {
          return (i ? 'L' : 'M') + (W / 2 + p[0] * k).toFixed(1) + ' ' + (H / 2 + p[1] * k).toFixed(1);
        }).join(' ');
      }
      var dIn = path(pts.slice(0, ci + 1)), dOut = path(pts.slice(ci));

      // 進行方向の矢印（終点の向き）
      var a = pts[pts.length - 2], b = pts[pts.length - 1];
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      var ax = W / 2 + b[0] * k, ay = H / 2 + b[1] * k, L = 11, wA = 6;
      var arrow = '<polygon class="rt-arrow" points="' +
        (ax).toFixed(1) + ',' + (ay).toFixed(1) + ' ' +
        (ax - L * Math.cos(ang) + wA * Math.sin(ang)).toFixed(1) + ',' + (ay - L * Math.sin(ang) - wA * Math.cos(ang)).toFixed(1) + ' ' +
        (ax - L * Math.cos(ang) - wA * Math.sin(ang)).toFixed(1) + ',' + (ay - L * Math.sin(ang) + wA * Math.cos(ang)).toFixed(1) + '"/>';

      // 縮尺バー（この地点の緯度から1pxあたりの距離を求める）
      var bar = '';
      var mPerPx = 156543.03392 * Math.cos((lat || 35) * Math.PI / 180) / Math.pow(2, sk.z) / k;
      var cand = [25, 50, 100, 200, 500, 1000];
      for (var i = 0; i < cand.length; i++) {
        var px = cand[i] / mPerPx;
        if (px >= 40 && px <= W * 0.5) {
          bar = '<g class="rt-scale"><line x1="10" y1="' + (H - 12) + '" x2="' + (10 + px).toFixed(1) + '" y2="' + (H - 12) + '"/>' +
            '<line x1="10" y1="' + (H - 16) + '" x2="10" y2="' + (H - 8) + '"/>' +
            '<line x1="' + (10 + px).toFixed(1) + '" y1="' + (H - 16) + '" x2="' + (10 + px).toFixed(1) + '" y2="' + (H - 8) + '"/>' +
            '<text x="' + (14 + px).toFixed(1) + '" y="' + (H - 8) + '">' + cand[i] + 'm</text></g>';
          break;
        }
      }

      return '<svg class="wx-sketch-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
        '<path class="rt-outline" d="' + dIn + '"/><path class="rt-outline" d="' + dOut + '"/>' +
        '<path class="rt-in" d="' + dIn + '"/><path class="rt-out" d="' + dOut + '"/>' + arrow +
        '<text class="rt-north" x="8" y="16">N↑</text>' + bar + '</svg>';
    }

    /** 埋め込みタイルを並べて静止地図を作る（通信不要） */
    function staticMapHtml(uid, lat, lon) {
      var m = offlineMap();
      if (!m || !m.layout || !m.layout[uid]) return '';
      var L = m.layout[uid], W = m.w, H = m.h;
      var left = L.cx - W / 2, top = L.cy - H / 2;
      var x0 = Math.floor(left / 256), x1 = Math.floor((left + W - 1) / 256);
      var y0 = Math.floor(top / 256), y1 = Math.floor((top + H - 1) / 256);
      var imgs = '', got = 0;
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var d = m.tiles[L.z + '/' + x + '/' + y];
          if (!d) continue;
          got++;
          imgs += '<img alt="" src="' + d + '" style="left:' + Math.round(x * 256 - left) + 'px;top:' + Math.round(y * 256 - top) + 'px">';
        }
      }
      if (!got) return '';
      return tapWrap(lat, lon,
        '<div class="wx-static-map" style="width:' + W + 'px;height:' + H + 'px">' + imgs +
        sketchSvg(uid, W, H, lat, false) + '<div class="wx-static-pin"></div></div>' +
        '<div class="wx-attr">' + esc(m.attr || '') + '・赤い線＝進む向き／タップでGoogleマップ</div>');
    }

    /** タイルが無い地点用：略図だけを描く */
    function sketchBoxHtml(uid, lat, lon) {
      var W = (offlineMap() && offlineMap().w) || 320, H = (offlineMap() && offlineMap().h) || 192;
      var svg = sketchSvg(uid, W, H, lat, true);
      if (!svg) return '';
      return tapWrap(lat, lon,
        '<div class="wx-sketch" style="width:' + W + 'px;height:' + H + 'px">' + svg +
        '<div class="wx-static-pin"></div></div>' +
        '<div class="wx-attr">GPXから起こしたコースの形（北が上／灰＝手前、赤＝進む向き）／タップでGoogleマップ</div>');
    }

    /** 埋め込み予報から、その地点・その時刻に一番近い値を取り出す */
    function embeddedWeatherAt(lat, lon, eta) {
      var w = offlineWx();
      if (!w || !w.points || !w.points.length) return null;
      var best = null, bd = Infinity;
      w.points.forEach(function (p) {
        var dy = p.lat - lat, dx = (p.lon - lon) * Math.cos(lat * Math.PI / 180);
        var d = dy * dy + dx * dx;
        if (d < bd) { bd = d; best = p; }
      });
      var target = eta.getFullYear() + '-' + pad2(eta.getMonth() + 1) + '-' + pad2(eta.getDate()) + 'T' + pad2(eta.getHours());
      var idx = w.time.indexOf(target + ':00');
      if (idx === -1) idx = w.time.findIndex(function (t) { return t.slice(0, 13) === target; });
      if (idx === -1 || best.t[idx] == null) return null;
      return { temp: best.t[idx], rain: best.p[idx], ws: best.ws[idx], wd: best.wd[idx], fetchedAt: w.fetchedAt };
    }

    function renderWxCard(body, v, eta, brg, stamp) {
      var rel = windRelation(brg, v.wd), info = relationLabel(rel);
      body.innerHTML =
        '<div class="wx-weather-card">' +
          '<div class="wx-wind-arrow ' + rel + '"><span class="arrow-icon">' + info.icon + '</span>' +
          '<span class="arrow-label">' + info.label + '</span></div>' +
          '<div class="wx-details">' +
            '<div class="wx-item"><span class="wx-label">ETA</span><span class="wx-value">' + fmtDateTime(eta) + '</span></div>' +
            '<div class="wx-item"><span class="wx-label">気温</span><span class="wx-value">' + v.temp.toFixed(1) + '℃</span></div>' +
            '<div class="wx-item"><span class="wx-label">風</span><span class="wx-value">' + bearingToCompass(v.wd) + ' ' + v.ws.toFixed(1) + 'm/s</span></div>' +
            '<div class="wx-item"><span class="wx-label">降水量</span><span class="wx-value' + (v.rain > 0 ? ' rain-warn' : '') + '">' + v.rain.toFixed(1) + 'mm/h</span></div>' +
          '</div>' +
        '</div>' +
        (stamp ? '<div class="wx-stamp">' + esc(stamp) + '</div>' : '');
    }

    function loadWx(panel) {
      var lat = parseFloat(panel.dataset.lat), lon = parseFloat(panel.dataset.lon);
      var brg = parseFloat(panel.dataset.brg || '0');
      var dist = parseFloat(panel.dataset.dist || '0');
      var uid = panel.dataset.uid;
      var tiles = staticMapHtml(uid, lat, lon);
      var mapUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' +
        (lon - 0.0025) + '%2C' + (lat - 0.0015) + '%2C' + (lon + 0.0025) + '%2C' + (lat + 0.0015) +
        '&layer=mapnik&marker=' + lat + '%2C' + lon;

      if (tiles) {
        // 焼き込んだ地図なら通信不要
        panel.innerHTML = '<div class="wx-body"></div>' + tiles;
      } else if (scheme() === 'web') {
        panel.innerHTML = '<div class="wx-body"></div>' +
          '<div class="wx-map-frame"><iframe loading="lazy" src="' + mapUrl + '"></iframe></div>' +
          '<div class="wx-net-note" hidden></div>';
        probeMap(panel, mapUrl);
      } else {
        // 端末内のファイルとして開いている：まず略図を出し、通信できるようなら地図に差し替える
        panel.innerHTML = '<div class="wx-body"></div>' +
          '<div class="wx-mapslot">' + (sketchBoxHtml(uid, lat, lon) ||
            '<div class="wx-net-note">📱 ' + localSchemeNote() +
            '<br><a href="' + gmapUrl(lat, lon) + '" target="_blank" rel="noopener">Googleマップで開く ↗</a></div>') +
          '</div>';
        fetchWithTimeout(mapUrl, 8000, { mode: 'no-cors' }).then(function () {
          var slot = panel.querySelector('.wx-mapslot');
          if (slot) {
            slot.innerHTML = '<div class="wx-map-frame"><iframe loading="lazy" src="' + mapUrl + '"></iframe></div>';
          }
        }).catch(function () { /* 略図のままにする */ });
      }
      loadWeather(panel, lat, lon, brg, dist);
    }

    /* 地図は表示されなくてもエラーを出せない（別オリジンのiframe）ため、
       同じURLへの到達性だけ確かめて、駄目そうなら理由を書き添える */
    function probeMap(panel, url) {
      var note = panel.querySelector('.wx-net-note');
      if (!note) return;
      fetchWithTimeout(url, 10000, { mode: 'no-cors' }).catch(function (e) {
        note.hidden = false;
        note.innerHTML = '🗺 地図（openstreetmap.org）への接続を確認できませんでした。' +
          '上に地図が表示されていれば問題ありません。<br>' + esc(netHint(e));
      });
    }

    function loadWeather(panel, lat, lon, brg, dist) {
      var body = panel.querySelector('.wx-body');
      if (!body) return;
      var start = startDateTime();
      if (!start) { body.innerHTML = '<div class="wx-error">出走日時を設定してください</div>'; return; }

      var eta = new Date(start.getTime() + etaMinForDist(dist) * 60000);
      var emb = embeddedWeatherAt(lat, lon, eta);
      var embStamp = emb ? '埋め込み予報（' + fmtDateTime(new Date(emb.fetchedAt)) + '取得）' : '';

      // 端末内ファイルとして開いている場合は待たせない。
      // 埋め込み予報をすぐ出し、通信できる環境なら裏で最新に差し替える。
      var offlineFirst = (scheme() !== 'web') && !!emb;
      if (offlineFirst) renderWxCard(body, emb, eta, brg, embStamp);
      if (scheme() === 'app' && !emb) {
        body.innerHTML = '<div class="wx-net-note">📱 ' + localSchemeNote() + '</div>';
        return;
      }

      var diffDays = (eta - new Date()) / 86400000;
      if (diffDays < -0.5 || diffDays > 16) {
        if (emb) { renderWxCard(body, emb, eta, brg, embStamp); return; }
        body.innerHTML = '<div class="wx-outofrange">⚠️ 通過予定 ' + fmtDateTime(eta) +
          ' は天気予報の範囲外です<br>予報は本日から概ね16日先まで（Open-Meteoの仕様）。開催が近づくと表示されます。</div>';
        return;
      }
      if (!offlineFirst) body.innerHTML = '<div class="wx-loading">天気を取得中…</div>';

      var key = lat.toFixed(2) + ',' + lon.toFixed(2);
      var p = wxCache[key];
      if (!p) {
        p = fetchWithTimeout('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
          '&hourly=temperature_2m,precipitation,windspeed_10m,winddirection_10m&timezone=Asia%2FTokyo&forecast_days=16', 10000)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        // 失敗した結果はキャッシュに残さない（再試行できるように）
        p.catch(function () { delete wxCache[key]; });
        wxCache[key] = p;
      }

      p.then(function (data) {
        var times = data.hourly.time;
        var target = eta.getFullYear() + '-' + pad2(eta.getMonth() + 1) + '-' + pad2(eta.getDate()) + 'T' + pad2(eta.getHours());
        var idx = times.findIndex(function (t) { return t.slice(0, 13) === target; });
        if (idx === -1) {
          idx = times.reduce(function (best, t, i) {
            return Math.abs(new Date(t) - eta) < Math.abs(new Date(times[best]) - eta) ? i : best;
          }, 0);
        }
        renderWxCard(body, {
          temp: data.hourly.temperature_2m[idx], rain: data.hourly.precipitation[idx],
          ws: data.hourly.windspeed_10m[idx], wd: data.hourly.winddirection_10m[idx]
        }, eta, brg, '');
      }).catch(function (e) {
        if (emb) {
          // すでに埋め込み分を表示済みならそのまま
          if (!offlineFirst) renderWxCard(body, emb, eta, brg, embStamp + '／通信できないため埋め込み分を表示');
          return;
        }
        body.innerHTML =
          '<div class="wx-error">天気を取得できませんでした' +
            '<span class="wx-sub">' + esc(netHint(e)) + '<br>接続先：api.open-meteo.com</span></div>' +
          '<div style="text-align:center;margin-bottom:10px;"><button class="wx-retry">再試行</button></div>';
        body.querySelector('.wx-retry').addEventListener('click', function () {
          loadWeather(panel, lat, lon, brg, dist);
        });
      });
    }

    /* ---- 操作 ---- */
    window.__cue = {
      changeSpeed: function (d) { S.speed = Math.max(10, Math.min(30, S.speed + d)); updateAll(); },
      changeOffset: function (d) { S.offsetKm = Math.round((S.offsetKm + d) * 10) / 10; updateAll(); },
      resetOffset: function () { S.offsetKm = 0; updateAll(); },
      showView: function (name) {
        document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
        document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
        try { localStorage.setItem(LS_KEY + ':view', name); } catch (e) {}
      }
    };

    function init() {
      loadState();
      var dateEl = document.getElementById('start-date'), timeEl = document.getElementById('start-time');
      dateEl.value = S.startDate || '';
      timeEl.value = S.startTime || '07:00';
      dateEl.addEventListener('change', function () { S.startDate = dateEl.value; updateAll(); });
      timeEl.addEventListener('change', function () { S.startTime = timeEl.value; renderSimple(); renderDetail(); updateAll(); });
      renderSimple();
      renderDetail();
      updateAll();
      var v = 'simple';
      try { v = localStorage.getItem(LS_KEY + ':view') || 'simple'; } catch (e) {}
      window.__cue.showView(v);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  /* ==================== HTML組み立て ==================== */
  function buildHtml(model) {
    var m = model.meta;
    var d = m.startDate instanceof Date ? m.startDate : new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    // 推定値で補ったところは、閲覧者にはっきり分かるようにする（ブルベでは時刻が命に関わる）
    var warnings = [];
    if (m.acpTimes) warnings.push('Open／Closeに<b>主催者の公式値ではなくACP基準の推定値</b>を使った地点があります。必ず配布キューシートで確認してください。');
    if (m.cpFromGpx) warnings.push('CP（PC・通過チェック）はExcelではなく<b>GPXのウェイポイント</b>から構成しています。');
    if (m.autoTurns) warnings.push('曲がり角は<b>GPXの方位変化から自動抽出</b>したものです（道路名・ランドマークは入りません）。');
    (model.notices || []).forEach(function (n) { warnings.push(NS.util.escapeHtml(n)); });

    var payload = {
      meta: {
        id: m.title,
        title: m.title,
        totalKm: m.totalKm,
        gpxTotalKm: m.gpxTotalKm,
        scale: m.scale,
        defaultSpeed: m.defaultSpeed,
        startDate: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        startTime: pad(d.getHours()) + ':' + pad(d.getMinutes()),
        startLat: m.startLat, startLon: m.startLon,
        autoTurns: m.autoTurns,
        generatedAt: (m.generatedAt || new Date()).toISOString()
      },
      cps: model.cps.map(function (c) {
        return {
          kind: c.kind, label: c.label, name: c.name, distKm: round1(c.distKm), segKm: round1(c.segKm || 0),
          openMin: c.openMin == null ? null : Math.round(c.openMin),
          closeMin: c.closeMin == null ? null : Math.round(c.closeMin),
          note: c.note || '', road: c.road || '', landmark: c.landmark || '',
          lat: round6(c.lat), lon: round6(c.lon), bearing: round1(c.bearing || 0)
        };
      }),
      offline: model.offline || null,
      cues: model.cues.map(function (c) {
        var o = {
          kind: c.kind, distKm: round1(c.distKm),
          lat: round6(c.lat), lon: round6(c.lon), bearing: round1(c.bearing || 0)
        };
        if (c.kind === 'turn') {
          o.no = c.no; o.direction = c.direction; o.directionText = c.directionText || '';
          o.road = c.road || ''; o.landmark = c.landmark || ''; o.note = c.note || '';
          o.sign = c.sign || '';
          o.name = c.name || ''; o.signal = (c.signal === null || c.signal === undefined) ? null : c.signal;
        } else {
          o.label = c.label; o.name = c.name || ''; o.note = c.note || '';
          o.road = c.road || ''; o.landmark = c.landmark || '';
          o.openMin = c.openMin == null ? null : Math.round(c.openMin);
          o.closeMin = c.closeMin == null ? null : Math.round(c.closeMin);
        }
        return o;
      })
    };
    var json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    var esc = NS.util.escapeHtml;

    return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">\n' +
      '<meta name="generator" content="brevet-cuesheet-generator">\n' +
      '<title>' + esc(m.title) + '</title>\n' +
      '<style>' + outputCss() + '</style>\n' +
      '</head>\n<body>\n' +
      '<header><span class="icon">🚴</span><h1>' + esc(m.title) + '</h1></header>\n' +
      '<nav>\n' +
      '  <button data-view="simple" class="active" onclick="__cue.showView(\'simple\')">📋 簡易</button>\n' +
      '  <button data-view="detail" onclick="__cue.showView(\'detail\')">🗺 詳細</button>\n' +
      '</nav>\n' +
      '<main>\n' +
      (warnings.length
        ? '  <div class="gen-notice">⚠️ <b>この表示は自動生成です</b><ul><li>' +
            warnings.join('</li><li>') + '</li></ul></div>\n'
        : '') +
      '  <div class="settings">\n' +
      '    <div class="settings-title">🚴 出走日時・ペース（ETA・天気予報の計算に使用）</div>\n' +
      '    <div class="settings-row" style="margin-bottom:8px;">\n' +
      '      <input type="date" id="start-date"><input type="time" id="start-time" value="07:00">\n' +
      '    </div>\n' +
      '    <div class="settings-row">\n' +
      '      <button class="stepper-btn" onclick="__cue.changeSpeed(-1)">−1</button>\n' +
      '      <span class="stepper-display" id="speed-display">18 km/h</span>\n' +
      '      <button class="stepper-btn" onclick="__cue.changeSpeed(1)">+1</button>\n' +
      '    </div>\n' +
      '  </div>\n' +
      '  <div class="settings">\n' +
      '    <div class="settings-title">📏 距離補正（サイコン実測値に合わせる）</div>\n' +
      '    <div class="settings-row">\n' +
      '      <button class="stepper-btn big" onclick="__cue.changeOffset(-1)">−1</button>\n' +
      '      <button class="stepper-btn" onclick="__cue.changeOffset(-0.1)">−0.1</button>\n' +
      '      <span class="stepper-display" id="offset-display">±0.0 km</span>\n' +
      '      <button class="stepper-btn" onclick="__cue.changeOffset(0.1)">+0.1</button>\n' +
      '      <button class="stepper-btn big" onclick="__cue.changeOffset(1)">+1</button>\n' +
      '    </div>\n' +
      '    <div style="text-align:center;"><button class="link-btn" onclick="__cue.resetOffset()">リセット</button></div>\n' +
      '  </div>\n' +
      '\n' +
      '  <section class="view active" id="view-simple">\n' +
      '    <div class="total-banner">\n' +
      '      <div class="banner-top">\n' +
      '        <div class="banner-left">\n' +
      '          <div class="event-name">' + esc(m.title) + '</div>\n' +
      '          <div class="total-label">総距離</div>\n' +
      '          <div><span class="value" id="banner-total">' + m.totalKm.toFixed(1) + '</span><span class="unit"> KM</span></div>\n' +
      '          <div class="sub">' + esc(m.startName || '') + ' スタート</div>\n' +
      '          <div class="sub" id="banner-sun"></div>\n' +
      '          <div class="sub" id="banner-est"></div>\n' +
      '        </div>\n' +
      '        <div class="banner-right">\n' +
      '          <div class="label">スタート</div>\n' +
      '          <div class="start-time" id="banner-start">--:--</div>\n' +
      '          <div class="label" id="banner-date"></div>\n' +
      '          <div class="sub" id="banner-goalclose"></div>\n' +
      '        </div>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '    <div class="card">\n' +
      '      <div class="legend">\n' +
      '        <div class="legend-item"><div class="legend-dot" style="background:#ff3b30"></div>PC（レシート）</div>\n' +
      '        <div class="legend-item"><div class="legend-dot" style="background:#5856d6"></div>通過チェック</div>\n' +
      '        <div class="legend-item"><div class="legend-dot" style="background:#34c759"></div>Start/Goal</div>\n' +
      '        <div class="legend-item">タップで詳細・休憩設定</div>\n' +
      '      </div>\n' +
      '      <div id="cp-list"></div>\n' +
      '    </div>\n' +
      '  </section>\n' +
      '\n' +
      '  <section class="view" id="view-detail">\n' +
      '    <div id="cue-list"></div>\n' +
      '  </section>\n' +
      '\n' +
      '  <div class="footer-note">' +
      esc('GPX ' + m.gpxTotalKm + 'km ／ キューシート ' + m.totalKm + 'km（補正係数 ' + m.scale + '）') + '<br>' +
      esc('CP ' + m.cpCount + '地点・ポイント ' + m.turnCount + '件' + (m.autoTurns ? '（曲がり角はGPXから自動抽出）' : '')) + '<br>' +
      esc('生成 ' + (m.generatedAt || new Date()).toLocaleString('ja-JP')) + ' / ブルベ キューシート生成ツール<br>' +
      '天気は <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>、地図は <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> © OpenStreetMap contributors' +
      '</div>\n' +
      '</main>\n' +
      '<script>window.__COURSE__=' + json + ';<\/script>\n' +
      '<script>(' + runtime.toString() + ')();<\/script>\n' +
      '</body>\n</html>\n';
  }

  function round1(v) { return v == null ? null : Math.round(v * 10) / 10; }
  function round6(v) { return v == null ? null : Math.round(v * 1000000) / 1000000; }

  NS.template = { buildHtml: buildHtml, outputCss: outputCss };
})(BCG);
