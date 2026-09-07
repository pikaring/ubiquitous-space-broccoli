/* Excel（キューシート）× GPX の突き合わせ → 出力用データモデルの構築 */
(function (NS) {
  'use strict';
  var U = NS.util, G = NS.gpx, X = NS.xlsxImport;

  var DIR_PATTERNS = [
    { re: /uターン|ユーターン|u-?turn|折り返し/i, dir: 'uturn' },
    { re: /斜め?右|右斜め/, dir: 'slight-right' },
    { re: /斜め?左|左斜め/, dir: 'slight-left' },
    { re: /右/, dir: 'right' },
    { re: /左/, dir: 'left' },
    { re: /直進|そのまま|straight|進む/, dir: 'straight' }
  ];

  function parseDirection(text) {
    var s = U.normalizeText(text);
    if (!s) return null;
    for (var i = 0; i < DIR_PATTERNS.length; i++) {
      if (DIR_PATTERNS[i].re.test(s)) return DIR_PATTERNS[i].dir;
    }
    return null;
  }

  function parseSignal(text) {
    if (text === null || text === undefined) return null;
    var s = U.normalizeText(text);
    if (!s) return null;
    if (/^(なし|無|×|x|✕|-|ー|no)$/i.test(s)) return false;
    if (/(信号|あり|有|○|◯|●|yes|y|1)/i.test(s)) return true;
    return null;
  }

  /** 文字列類似度（バイグラムDice係数） */
  function similarity(a, b) {
    a = U.normalizeText(a).toLowerCase().replace(/[\s　・･]/g, '');
    b = U.normalizeText(b).toLowerCase().replace(/[\s　・･]/g, '');
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.9;
    var pairs = {}, count = 0, hit = 0;
    for (var i = 0; i < a.length - 1; i++) { var k = a.substr(i, 2); pairs[k] = (pairs[k] || 0) + 1; }
    for (var j = 0; j < b.length - 1; j++) {
      var k2 = b.substr(j, 2); count++;
      if (pairs[k2]) { pairs[k2]--; hit++; }
    }
    var denom = (a.length - 1) + count;
    return denom > 0 ? (2 * hit) / denom : 0;
  }

  /* ---------- ACP基準のOpen/Close（Excelに時刻が無い場合のフォールバック） ---------- */
  // 上限速度: 〜200km 34、〜400km 32、〜600km 30、〜1000km 28 (km/h)
  function acpOpenMin(km) {
    var segs = [[200, 34], [200, 32], [200, 30], [400, 28]];
    var rest = km, min = 0;
    for (var i = 0; i < segs.length && rest > 0; i++) {
      var d = Math.min(rest, segs[i][0]);
      min += d / segs[i][1] * 60;
      rest -= d;
    }
    if (rest > 0) min += rest / 28 * 60; // 1000km超は概算
    return Math.round(min);
  }
  // 下限速度: 〜600km 15、600km超 11.428 (km/h)
  function acpCloseMin(km) {
    if (km <= 600) return Math.round(km / 15 * 60);
    return Math.round(600 / 15 * 60 + (km - 600) / 11.428 * 60);
  }
  // 認定距離ごとの制限時間（分）
  var ACP_LIMIT = { 200: 810, 300: 1200, 400: 1620, 600: 2400, 1000: 4500 };
  function acpTotalLimitMin(totalKm) {
    var keys = Object.keys(ACP_LIMIT).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) {
      if (totalKm <= keys[i] + 20) return ACP_LIMIT[keys[i]];
    }
    return acpCloseMin(totalKm);
  }

  /** マッピング済みシートから生レコードを取り出す */
  function extractRecords(sheet) {
    var map = sheet.colMap || {};
    var out = [];
    for (var r = sheet.headerRow + 1; r < sheet.rows.length; r++) {
      var row = sheet.rows[r];
      if (!row) continue;
      function cell(key) {
        var c = map[key];
        return (c === undefined || c === null || c < 0) ? null : row[c];
      }
      var rec = {
        sheet: sheet.name,
        rowIndex: r,
        no: cell('no'),
        kindText: cell('kind'),
        name: U.normalizeText(cell('name')),
        dist: X.parseDistance(cell('dist')),
        segDist: X.parseDistance(cell('segDist')),
        openRaw: X.parseTimeCell(cell('open')),
        closeRaw: X.parseTimeCell(cell('close')),
        direction: parseDirection(cell('direction')),
        directionText: U.normalizeText(cell('direction')),
        road: U.normalizeText(cell('road')),
        landmark: U.normalizeText(cell('landmark')),
        signal: parseSignal(cell('signal')),
        note: U.normalizeText(cell('note'))
      };
      var hasText = rec.name || rec.road || rec.landmark || rec.note || rec.directionText;
      if (rec.dist === null && !hasText) continue;      // 空行
      if (rec.dist === null && !rec.openRaw && !rec.closeRaw && !rec.name) continue;
      rec.kind = X.detectKind(rec.kindText, rec.name);
      // 詳細シートに種別列が無く、進路欄に「Start」「PC1」等が入っている書式に対応
      if (!rec.kind && map.kind === undefined && rec.directionText && !rec.direction) {
        rec.kind = X.detectKind(rec.directionText, '');
      }
      out.push(rec);
    }
    // 区間距離しか無いシートは積算を復元する
    var hasDist = out.some(function (x) { return x.dist !== null; });
    if (!hasDist && out.some(function (x) { return x.segDist !== null; })) {
      var acc = 0;
      out.forEach(function (x) { acc += (x.segDist || 0); x.dist = Math.round(acc * 10) / 10; });
    }
    return out.filter(function (x) { return x.dist !== null; });
  }

  /**
   * 距離列が「積算」か「区間」かを判定し、区間なら積算に直す。
   * 主催者によっては区間距離しか載っていない（見出しは「距離」だけ）ことがあり、
   * そのまま積算として扱うと距離も並び順も座標も全部ずれる。
   * @returns {{mode:'cumulative'|'segment', total:number}}
   */
  function normalizeDistances(recs, gpxTotalKm) {
    var vals = recs.map(function (r) { return r.dist; }).filter(function (v) { return v !== null; });
    if (vals.length < 3) return { mode: 'cumulative', total: vals.length ? vals[vals.length - 1] : 0 };

    var drops = 0;
    for (var i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1] - 0.05) drops++;
    var cumMax = Math.max.apply(null, vals);
    var accTotal = vals.reduce(function (a, b) { return a + b; }, 0);
    if (drops === 0) return { mode: 'cumulative', total: cumMax };

    // 積算とみなした場合と、区間を足し上げた場合で、GPXの総距離に近い方を採用する
    var ref = gpxTotalKm || cumMax;
    var errCum = Math.abs(cumMax - ref) / ref;
    var errAcc = Math.abs(accTotal - ref) / ref;
    if (errAcc >= errCum) return { mode: 'cumulative', total: cumMax };

    var acc = 0;
    recs.forEach(function (r) {
      if (r.dist === null) return;
      acc += r.dist;
      r.segDist = r.dist;             // 元の値は区間距離として残す
      r.dist = Math.round(acc * 10) / 10;
    });
    return { mode: 'segment', total: Math.round(acc * 10) / 10 };
  }

  /** GPXのwptから、CPに対応するものを探す */
  function findWaypoint(track, rec, interpKm, opt) {
    var best = null;
    track.waypoints.forEach(function (w) {
      if (!w.name || w.km == null) return;
      if (w.offTrackM > 300) return;                         // コースから離れすぎ
      if (Math.abs(w.km - interpKm) > opt.maxKmDiff) return; // 距離が違いすぎ
      var sim = similarity(w.name, rec.name);
      if (sim < opt.minSimilarity) return;
      var score = sim - Math.abs(w.km - interpKm) / (opt.maxKmDiff * 10);
      if (!best || score > best.score) best = { w: w, sim: sim, score: score };
    });
    return best;
  }

  /**
   * コースモデルを組み立てる
   * @param {object} track  GPX
   * @param {Array}  sheets [{name, rows, headerRow, colMap, role:'simple'|'detail'|'ignore'}]
   * @param {object} opt
   */
  function buildCourse(track, sheets, opt) {
    opt = opt || {};
    var startDate = opt.startDate || new Date();

    var notices = [];
    var simpleRecs = [], detailRecs = [];
    (sheets || []).forEach(function (s) {
      if (s.role === 'simple') simpleRecs = simpleRecs.concat(extractRecords(s));
      else if (s.role === 'detail') detailRecs = detailRecs.concat(extractRecords(s));
    });
    // 距離列の意味（積算／区間）をシートごとに判定して揃える
    [['簡易', simpleRecs], ['詳細', detailRecs]].forEach(function (pair) {
      if (!pair[1].length) return;
      var r = normalizeDistances(pair[1], track.totalKm);
      if (r.mode === 'segment') {
        notices.push(pair[0] + 'シートの距離列は区間距離と判断し、積算距離に変換しました（合計 ' + r.total + 'km）。');
      }
    });

    // 詳細シートしか無い場合は、そこからCPを拾う
    var cpRecs = simpleRecs.filter(function (r) { return r.kind; });
    if (!cpRecs.length) cpRecs = detailRecs.filter(function (r) { return r.kind; });
    if (!simpleRecs.length) simpleRecs = cpRecs;

    // Excelが無い（またはCPが取れない）場合：GPXのウェイポイント名からCPを組み立てる
    var cpFromGpx = false;
    if (!cpRecs.length) {
      cpFromGpx = true;
      cpRecs = track.waypoints
        .filter(function (w) { return w.name && w.km != null && X.detectKind('', w.name); })
        .sort(function (a, b) { return a.km - b.km; })
        .map(function (w) {
          return {
            sheet: '(GPX)', name: w.name, dist: Math.round(w.km * 10) / 10,
            kind: X.detectKind('', w.name), note: w.desc || '', road: '', landmark: '',
            openRaw: null, closeRaw: null, fromWpt: w
          };
        });
      var hasStart = cpRecs.some(function (r) { return r.kind === 'start' || r.dist < 0.3; });
      if (!hasStart) {
        cpRecs.unshift({ sheet: '(GPX)', name: 'スタート', dist: 0, kind: 'start', note: '', road: '', landmark: '', openRaw: null, closeRaw: null });
      }
      var hasGoal = cpRecs.some(function (r) { return r.kind === 'goal'; });
      if (!hasGoal) {
        cpRecs.push({ sheet: '(GPX)', name: 'ゴール', dist: Math.round(track.totalKm * 10) / 10, kind: 'goal', note: '', road: '', landmark: '', openRaw: null, closeRaw: null });
      }
    }

    // 総距離：Excel優先 → 無ければGPX
    var excelMax = 0;
    simpleRecs.concat(detailRecs).forEach(function (r) { if (r.dist > excelMax) excelMax = r.dist; });
    var totalKm = opt.totalKmOverride || excelMax || track.totalKm;
    // Excelの総距離がGPXとかけ離れている場合は採用しない（列の取り違えなどの取りこぼし）
    if (!opt.totalKmOverride && track.totalKm > 0) {
      var ratio = totalKm / track.totalKm;
      if (ratio < 0.8 || ratio > 1.25) {
        notices.push('Excelから読めた総距離 ' + Math.round(totalKm * 10) / 10 + 'km がGPX（' +
          Math.round(track.totalKm * 10) / 10 + 'km）と大きく違うため、GPXの距離を使いました。' +
          'STEP2で距離列の対応を確認してください。');
        totalKm = track.totalKm;
      }
    }
    var scale = (track.totalKm > 0 && totalKm > 0) ? (totalKm / track.totalKm) : 1;

    /* --- CP（Start/PC/通過/Goal） --- */
    var counters = { pc: 0, pass: 0 };
    var cps = cpRecs.slice().sort(function (a, b) { return a.dist - b.dist; }).map(function (r, i) {
      var kind = r.kind;
      if (!kind) kind = 'pc';
      if (i === 0 && r.dist <= 0.2) kind = 'start';
      return {
        kind: kind,
        label: X.extractLabel(kind, (r.kindText || '') + ' ' + r.name, counters),
        name: r.name,
        distKm: r.dist,
        note: r.note,
        road: r.road,
        landmark: r.landmark,
        openRaw: r.openRaw,
        closeRaw: r.closeRaw
      };
    });
    // Goalが種別判定されていない場合、最終地点をGoalに
    if (cps.length && !cps.some(function (c) { return c.kind === 'goal'; })) {
      var last = cps[cps.length - 1];
      if (Math.abs(last.distKm - totalKm) < 1.0) { last.kind = 'goal'; last.label = 'Goal'; }
    }

    // 詳細シート側のCP行（道路名・ランドマーク・備考）を簡易シートのCPへ合流させる
    var detailCps = detailRecs.filter(function (r) { return r.kind; });
    if (detailCps.length && detailCps !== cpRecs && cpRecs.length && cpRecs[0].sheet !== detailCps[0].sheet) {
      detailCps.forEach(function (r) {
        var best = null, bestDiff = Infinity;
        cps.forEach(function (c) {
          var d = Math.abs(c.distKm - r.dist);
          if (d < bestDiff) { bestDiff = d; best = c; }
        });
        if (!best || bestDiff > 0.6) return;
        if (!best.landmark && r.landmark) best.landmark = r.landmark;
        if (!best.road && r.road && r.road !== best.name) best.road = r.road;
        if (r.note && (best.note || '').indexOf(r.note) < 0) {
          best.note = best.note ? best.note + ' / ' + r.note : r.note;
        }
      });
    }

    // Open/Close を出走からの経過分に解決
    var resolved = X.resolveTimes(cps.map(function (c) { return { open: c.openRaw, close: c.closeRaw }; }), startDate);
    cps.forEach(function (c, i) { c.openMin = resolved[i].open; c.closeMin = resolved[i].close; });

    // Excelに時刻が無い地点はACP基準（上限34/32/30/28km/h・下限15km/h）で補完する
    var acpUsed = false;
    if (opt.acpFallback !== false) {
      var limitMin = opt.timeLimitMin || acpTotalLimitMin(totalKm);
      cps.forEach(function (c) {
        if (c.openMin == null) { c.openMin = c.kind === 'start' ? 0 : acpOpenMin(c.distKm); acpUsed = true; }
        if (c.closeMin == null) {
          c.closeMin = c.kind === 'start' ? 30
            : (c.kind === 'goal' ? limitMin : Math.min(limitMin, acpCloseMin(c.distKm)));
          acpUsed = true;
        }
      });
    }

    /* --- 曲がり角 --- */
    var turns = detailRecs.filter(function (r) { return !r.kind; }).map(function (r, idx) {
      return {
        kind: 'turn',
        order: idx,
        distKm: r.dist,
        no: (typeof r.no === 'number') ? r.no : null,
        direction: r.direction || 'straight',
        directionText: r.directionText,
        road: r.road,
        landmark: r.landmark,
        signal: r.signal,
        note: r.note,
        name: r.name
      };
    });

    var autoTurns = false;
    if (!turns.length && opt.autoTurns) {
      autoTurns = true;
      turns = NS.turns.detectTurns(track, opt.turnOpts).map(function (t) {
        return {
          kind: 'turn',
          distKm: Math.round(t.km * scale * 10) / 10,
          direction: t.direction,
          directionText: '',
          road: '', landmark: '', signal: null, note: '',
          name: '', auto: true, delta: t.delta,
          lat: t.lat, lon: t.lon, bearing: t.bearingOut, gpxKm: t.km
        };
      });
    }

    /* --- 座標マッチング --- */
    var report = [];
    var wpOpt = {
      maxKmDiff: (opt.wptMaxKmDiff === undefined ? 2.0 : opt.wptMaxKmDiff),
      minSimilarity: (opt.wptMinSimilarity === undefined ? 0.5 : opt.wptMinSimilarity)
    };
    function locate(pt, allowWpt) {
      var gpxKm = pt.distKm / scale;
      var loc = G.locateAtKm(track, gpxKm);
      pt.lat = loc.lat; pt.lon = loc.lon; pt.ele = loc.ele; pt.gpxKm = gpxKm;
      pt.bearing = G.bearingAtKm(track, gpxKm, opt.bearingSpanM || 200);
      pt.matchSource = '距離補間';
      if (allowWpt && opt.snapWaypoints !== false && pt.name) {
        var hit = findWaypoint(track, pt, gpxKm, wpOpt);
        if (hit) {
          var moveM = U.haversine(pt.lat, pt.lon, hit.w.lat, hit.w.lon);
          pt.lat = hit.w.lat; pt.lon = hit.w.lon; pt.gpxKm = hit.w.km;
          pt.bearing = G.bearingAtKm(track, hit.w.km, opt.bearingSpanM || 200);
          pt.matchSource = 'GPXウェイポイント（' + hit.w.name + '）';
          pt.snapMoveM = Math.round(moveM);
          pt.wptSim = Math.round(hit.sim * 100) / 100;
        }
      }
      report.push({
        kind: pt.kind, label: pt.label || '', name: pt.name || pt.road || '',
        distKm: pt.distKm, lat: pt.lat, lon: pt.lon,
        bearing: Math.round(pt.bearing), source: pt.matchSource,
        snapMoveM: pt.snapMoveM || 0
      });
    }
    cps.forEach(function (c) { locate(c, true); });
    turns.forEach(function (t) {
      if (t.auto) { // 自動抽出は既に座標を持つ
        report.push({ kind: 'turn', label: '', name: '（自動抽出）', distKm: t.distKm, lat: t.lat, lon: t.lon, bearing: Math.round(t.bearing), source: 'GPX方位変化点', snapMoveM: 0 });
        return;
      }
      locate(t, false);
    });

    /* --- 詳細リスト（CP＋曲がり角を距離順に統合） --- */
    var cues = cps.concat(turns).sort(function (a, b) {
      if (a.distKm !== b.distKm) return a.distKm - b.distKm;
      // 同一距離ならCPを先に、その次は元の並び（No.順）を保つ
      var k = (a.kind === 'turn' ? 1 : 0) - (b.kind === 'turn' ? 1 : 0);
      if (k) return k;
      if (a.no != null && b.no != null) return a.no - b.no;
      return (a.order || 0) - (b.order || 0);
    });
    var turnNo = 0;
    cues.forEach(function (c) {
      if (c.kind === 'turn') { turnNo++; if (c.no === null || c.no === undefined) c.no = turnNo; }
    });

    // 区間距離
    var prev = 0;
    cps.forEach(function (c) { c.segKm = Math.round((c.distKm - prev) * 10) / 10; prev = c.distKm; });

    var startPt = cps.length ? cps[0] : G.locateAtKm(track, 0);
    return {
      notices: notices,
      meta: {
        title: opt.title || track.name || 'ブルベ キューシート',
        startName: (cps[0] && cps[0].name) || '',
        goalName: (cps.length && cps[cps.length - 1].name) || '',
        totalKm: Math.round(totalKm * 10) / 10,
        gpxTotalKm: Math.round(track.totalKm * 100) / 100,
        scale: Math.round(scale * 100000) / 100000,
        startDate: startDate,
        startLat: startPt.lat, startLon: startPt.lon,
        defaultSpeed: opt.speed || 18,
        autoTurns: autoTurns,
        cpFromGpx: cpFromGpx,
        acpTimes: acpUsed,
        cpCount: cps.length,
        turnCount: turns.length,
        generatedAt: new Date()
      },
      cps: cps,
      cues: cues,
      report: report
    };
  }

  NS.match = {
    buildCourse: buildCourse,
    acpOpenMin: acpOpenMin,
    acpCloseMin: acpCloseMin,
    acpTotalLimitMin: acpTotalLimitMin,
    extractRecords: extractRecords,
    similarity: similarity,
    parseDirection: parseDirection,
    parseSignal: parseSignal
  };
})(BCG);
