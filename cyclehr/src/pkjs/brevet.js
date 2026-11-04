// CycleHR ブルベ機能: 計画の作成と、現在地の評価。
// ES5で書いてある。設定ページ(ブラウザ)とPebbleKit JSの両方から使う。
//   buildPlan : GPXとスタート時刻から計画を作る（設定ページで使う）
//   prepare   : 保存した計画のトラックを展開する
//   evaluate  : 現在地から、貯金・次の目標・ゴールまでの距離を出す
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Brevet = factory();
  }
}(this, function () {
  'use strict';

  // 開時刻の最高速度: [区間の長さ(km), km/h]。0-200, 200-400, 400-600, 600-1000, 1000-1300km
  var OPEN_SEGMENTS = [[200, 34], [200, 32], [200, 30], [400, 28], [300, 26]];
  // ゴールの制限時間(分)。公称距離ごとの規定値
  var GOAL_LIMIT_MIN = { 200: 810, 300: 1200, 400: 1620, 600: 2400, 1000: 4500, 1200: 5400 };
  // 公称距離の範囲(km)
  var NOMINAL_MIN = 100;
  var NOMINAL_MAX = 1300;
  // 保存するトラックの点の間隔(km)。長いコースでは、点の数が増えすぎないよう広げる
  var TRACK_STEP_MIN_KM = 0.2;
  var TRACK_MAX_POINTS = 2500;
  // 計画から外すウェイポイント(スタートとゴールは別に扱う)
  var SKIP_WPT = /^\s*(START|FINISH|GOAL|スタート|ゴール)/i;
  // 現在地の探索範囲: 前回の位置から戻る側(km)
  var SEARCH_BACK_KM = 2;
  // 進む側は、基本の余裕 + 時速45km × 前回からの経過時間。ただし上限あり
  var SEARCH_AHEAD_BASE_KM = 3;
  var SEARCH_AHEAD_SPEED_KMH = 45;
  var SEARCH_AHEAD_MAX_KM = 60;
  // 距離がこの差以内の候補は「同じ道の上」とみなす(km)
  var TIE_KM = 0.05;
  // 同じ道の上の候補が複数あるとき、前回より後ろの候補は、離れ具合をこの倍率で重く見る
  var BACKWARD_PENALTY = 3;
  // この距離よりコースから離れていたら、位置を更新しない(km)
  var MAX_OFF_ROUTE_KM = 0.5;
  // ゴール判定の距離(km)
  var FINISH_RADIUS_KM = 0.3;

  function rnd(x) { return Math.floor(x + 0.5); }

  function openMin(d) {
    var t = 0, rest = d, i, run;
    for (i = 0; i < OPEN_SEGMENTS.length && rest > 0; i++) {
      run = Math.min(rest, OPEN_SEGMENTS[i][0]);
      t += run / OPEN_SEGMENTS[i][1];
      rest -= run;
    }
    return t * 60;
  }

  // 最初の60kmは20km/hに1時間を足し、60〜600kmは15km/h、
  // 600〜1000kmは11.428km/h、1000〜1300kmは13.333km/h
  function closeMin(d) {
    if (d <= 60) { return d / 20 * 60 + 60; }
    if (d <= 600) { return d / 15 * 60; }
    if (d <= 1000) { return 2400 + (d - 600) / 11.428 * 60; }
    return 4500 + (d - 1000) / 13.333 * 60;
  }

  function hav(la1, lo1, la2, lo2) {
    var r = 6371.0088, rad = Math.PI / 180;
    var p1 = la1 * rad, p2 = la2 * rad;
    var a = Math.pow(Math.sin((p2 - p1) / 2), 2) +
      Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((lo2 - lo1) * rad / 2), 2);
    return 2 * r * Math.asin(Math.sqrt(a));
  }

  // ---- GPX -------------------------------------------------------------------

  function attr(tag, name) {
    var m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"').exec(tag);
    return m ? parseFloat(m[1]) : NaN;
  }

  function xmlText(s) {
    return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, '\'').replace(/&amp;/g, '&').replace(/^\s+|\s+$/g, '');
  }

  function parseGpx(text) {
    var pts = [], wpts = [], m, la, lo, re;
    re = /<(?:trkpt|rtept)\b[^>]*>/g;
    while ((m = re.exec(text)) !== null) {
      la = attr(m[0], 'lat');
      lo = attr(m[0], 'lon');
      if (!isNaN(la) && !isNaN(lo)) { pts.push([la, lo]); }
    }
    re = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g;
    while ((m = re.exec(text)) !== null) {
      la = attr(m[1], 'lat');
      lo = attr(m[1], 'lon');
      var nm = /<name>([\s\S]*?)<\/name>/.exec(m[2]);
      if (!isNaN(la) && !isNaN(lo)) {
        wpts.push({ name: nm ? xmlText(nm[1]) : '', lat: la, lon: lo });
      }
    }
    return { pts: pts, wpts: wpts };
  }

  // 時計のフォントで出せる短い名前にする。
  //   PC1 -> PC1 / 通過C1 -> C1 / 通過チェックB -> CB / 通過C-B -> CB
  // どれにも当たらないときは、名前の英数字の部分、それもなければ W1、W2 ... にする。
  function shortName(name, index) {
    var m = /^\s*PC\s*[-－ー]?\s*(\d+)/i.exec(name);
    if (m) { return 'PC' + m[1]; }
    m = /^\s*通過\s*(?:C|CP|チェック(?:ポイント)?)\s*[-－ー]?\s*([A-Za-z0-9]+)/i.exec(name);
    if (m) { return 'C' + m[1].toUpperCase(); }
    m = /^\s*(CP?)\s*[-－ー]?\s*(\d+)/i.exec(name);
    if (m) { return 'C' + m[2]; }
    var s = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5);
    return s || 'W' + (index + 1);
  }

  // ---- トラックの圧縮 ----------------------------------------------------------

  // 設定ページからURLで渡すので、URLエンコードで膨らまない文字だけを使う(0-9 a-z - .)
  function encodeTrack(pts, cum, scale) {
    var out = [], lastKm = -1e9, pl = 0, po = 0, pk = 0, n = pts.length, i, km, la, lo, k;
    var step = Math.max(TRACK_STEP_MIN_KM, cum[n - 1] * scale / TRACK_MAX_POINTS);
    for (i = 0; i < n; i++) {
      km = cum[i] * scale;
      if (i === 0 || i === n - 1 || km - lastKm >= step) {
        la = rnd(pts[i][0] * 1e5);
        lo = rnd(pts[i][1] * 1e5);
        k = rnd(km * 100);
        out.push((la - pl).toString(36), (lo - po).toString(36), (k - pk).toString(36));
        pl = la; po = lo; pk = k;
        lastKm = km;
      }
    }
    return out.join('.');
  }

  function decodeTrack(s) {
    var a = s.split('.'), lat = [], lon = [], km = [], i, pl = 0, po = 0, pk = 0;
    for (i = 0; i + 2 < a.length; i += 3) {
      pl += parseInt(a[i], 36);
      po += parseInt(a[i + 1], 36);
      pk += parseInt(a[i + 2], 36);
      lat.push(pl / 1e5);
      lon.push(po / 1e5);
      km.push(pk / 100);
    }
    return { lat: lat, lon: lon, km: km };
  }

  // ---- 計画 --------------------------------------------------------------------

  // opts: startEpoch(秒、必須) / officialTotal(km、主催者のキューシートの総延長) / nominal(公称距離)
  // 戻り値: { plan: 保存用, rows: 確認画面用, warnings: [] }
  function buildPlan(gpxText, opts) {
    var g = parseGpx(gpxText), pts = g.pts, n = pts.length, i, j;
    var warnings = [];
    if (n < 2) { throw new Error('GPXにトラックがありません'); }
    var cum = [0];
    for (i = 1; i < n; i++) {
      cum.push(cum[i - 1] + hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    }
    var scale = opts.officialTotal > 0 ? opts.officialTotal / cum[n - 1] : 1;
    var total = cum[n - 1] * scale;
    var nominal = opts.nominal || Math.floor(total / 100) * 100;
    if (nominal < NOMINAL_MIN || nominal > NOMINAL_MAX) {
      throw new Error('公称距離が' + NOMINAL_MIN + '〜' + NOMINAL_MAX + 'kmの範囲外です(' + nominal + 'km)');
    }
    if (Math.abs(scale - 1) > 0.01) {
      warnings.push('GPXの距離と総延長が1%以上ずれています(補正倍率 ' + scale.toFixed(4) + ')');
    }

    var wps = [], best, bi, d;
    for (j = 0; j < g.wpts.length; j++) {
      if (SKIP_WPT.test(g.wpts[j].name)) { continue; }  // スタートとゴールは計画の両端で扱う
      best = 1e9; bi = 0;
      for (i = 0; i < n; i++) {
        d = hav(g.wpts[j].lat, g.wpts[j].lon, pts[i][0], pts[i][1]);
        if (d < best) { best = d; bi = i; }
      }
      if (best > 0.1) { warnings.push(g.wpts[j].name + ' がコースから ' + rnd(best * 1000) + 'm 離れています'); }
      wps.push({ name: g.wpts[j].name, km: cum[bi] * scale });
    }
    wps.sort(function (a, b) { return a.km - b.km; });

    var rows = [], wp = [], used = {};
    for (i = 0; i < wps.length; i++) {
      var di = rnd(wps[i].km);  // 制限時刻は整数kmに丸めた距離で出す
      var o = rnd(openMin(di)), c = rnd(closeMin(di));
      var sn = shortName(wps[i].name, i);
      while (used[sn]) { sn = sn.slice(0, 4) + 'x'; }  // 同じ名前が重なったときの保険
      used[sn] = true;
      wp.push([sn, rnd(wps[i].km * 100) / 100, o, c]);
      rows.push({ name: wps[i].name, km: wps[i].km, openMin: o, closeMin: c });
    }
    if (!wps.length) { warnings.push('ウェイポイントがありません。次の目標はゴールだけになります'); }
    var goalClose = GOAL_LIMIT_MIN[nominal] || rnd(closeMin(nominal));
    var goal = [rnd(total * 100) / 100, rnd(openMin(nominal)), goalClose];
    rows.push({ name: 'ゴール', km: total, openMin: goal[1], closeMin: goal[2] });

    return {
      plan: {
        v: 1, start: opts.startEpoch, nominal: nominal, total: goal[0],
        wp: wp, goal: goal, trk: encodeTrack(pts, cum, scale)
      },
      rows: rows,
      warnings: warnings
    };
  }

  function prepare(plan) {
    return { plan: plan, trk: decodeTrack(plan.trk) };
  }

  // ---- 現在地 ------------------------------------------------------------------

  // コース上で現在地にいちばん近い点を探す。
  // win = { lo, hi, ref }: 探すkmの範囲と、前回のkm(ref、なければnull)。
  // 同じ道を往復する区間では、2本の道が数十m以内に重なる。距離がほぼ同じ候補のうち、
  // 前回のkmにいちばん近いものを選ぶ。ただし前回より後ろの候補は離れ具合を重く見て、
  // 折り返したあとに先へ進む向きを選ぶ。refがnullのときは、いちばん近い点を選ぶ。
  function locate(prep, lat, lon, win) {
    var t = prep.trk, n = t.km.length, i, c;
    var ky = 110.574, kx = Math.cos(lat * Math.PI / 180) * 111.32;
    var cands = [], bestDist = 1e9;
    for (i = 0; i + 1 < n; i++) {
      if (t.km[i + 1] < win.lo || t.km[i] > win.hi) { continue; }
      var ax = (t.lon[i] - lon) * kx, ay = (t.lat[i] - lat) * ky;
      var bx = (t.lon[i + 1] - lon) * kx, by = (t.lat[i + 1] - lat) * ky;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var u = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      if (u < 0) { u = 0; } else if (u > 1) { u = 1; }
      var px = ax + u * dx, py = ay + u * dy;
      var dist = Math.sqrt(px * px + py * py);
      cands.push({ distKm: dist, km: t.km[i] + u * (t.km[i + 1] - t.km[i]) });
      if (dist < bestDist) { bestDist = dist; }
    }
    var best = null, score;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      if (c.distKm > bestDist + TIE_KM) { continue; }
      if (win.ref === null) {
        score = c.distKm;
      } else if (c.km >= win.ref) {
        score = c.km - win.ref;
      } else {
        score = (win.ref - c.km) * BACKWARD_PENALTY;
      }
      if (best === null || score < best.score) {
        best = { distKm: c.distKm, km: c.km, score: score };
      }
    }
    return best;
  }

  // prevKm / prevTime は前回の結果。初回は null
  // 戻り値:
  //   { state: 2, deadline }                    スタート前(deadlineはスタート時刻)
  //   { state: 1, km, deadline, nextName, nextDistDm, goalDistDm }  走行中
  //   { state: 3, km, saving }                  ゴール済み(savingは分)
  //   null                                       コースから離れている、または位置が取れない
  function evaluate(prep, now, fix, prevKm, prevTime) {
    var plan = prep.plan, i, win;
    if (now < plan.start) { return { state: 2, deadline: plan.start }; }
    if (!fix) { return null; }
    if (prevKm === undefined) { prevKm = null; }

    if (prevKm === null) {
      // 前回の位置がない。スタートとゴールが同じ場所でも取り違えないよう、
      // スタート時刻からの経過時間で、進める距離の上限を決める
      win = {
        lo: -1,
        hi: Math.min(plan.total + 1,
          SEARCH_AHEAD_BASE_KM + SEARCH_AHEAD_SPEED_KMH * (now - plan.start) / 3600),
        ref: null
      };
    } else {
      var ahead = SEARCH_AHEAD_MAX_KM;
      if (prevTime) {
        ahead = Math.min(SEARCH_AHEAD_MAX_KM,
          SEARCH_AHEAD_BASE_KM + SEARCH_AHEAD_SPEED_KMH * Math.max(0, now - prevTime) / 3600);
      }
      win = { lo: prevKm - SEARCH_BACK_KM, hi: prevKm + ahead, ref: prevKm };
    }

    var loc = locate(prep, fix.lat, fix.lon, win);
    if (!loc || loc.distKm > MAX_OFF_ROUTE_KM) { return null; }
    var km = loc.km, goalClose = plan.goal[2];

    if (km >= plan.total - FINISH_RADIUS_KM && prevKm !== null && prevKm > plan.total * 0.5) {
      return { state: 3, km: km, saving: Math.floor((plan.start + goalClose * 60 - now) / 60) };
    }

    var next = null;
    for (i = 0; i < plan.wp.length; i++) {
      if (plan.wp[i][1] > km + 0.05) { next = plan.wp[i]; break; }
    }
    var nextName = next ? next[0] : 'GOAL';
    var nextKm = next ? next[1] : plan.total;
    return {
      state: 1,
      km: km,
      deadline: rnd(plan.start + Math.min(closeMin(km), goalClose) * 60),
      nextName: nextName,
      nextDistDm: Math.max(0, rnd((nextKm - km) * 10)),
      goalDistDm: Math.max(0, rnd((plan.total - km) * 10))
    };
  }

  return {
    buildPlan: buildPlan,
    prepare: prepare,
    evaluate: evaluate,
    locate: locate,
    parseGpx: parseGpx,
    openMin: openMin,
    closeMin: closeMin,
    shortName: shortName
  };
}));
