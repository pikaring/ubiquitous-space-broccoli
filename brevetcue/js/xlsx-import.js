/* Excelキューシート取り込み：シート読取・見出し推定・列推定・値パーサ
   主催者ごとに形式差が大きいため「自動推定＋UIで確認」を前提にする */
(function (NS) {
  'use strict';
  var U = NS.util;

  /* ---------- 列の役割と推定キーワード ---------- */
  var ROLES = [
    { key: 'no',        label: 'No.',        kw: ['no', 'no.', '№', '番号', '番'] },
    { key: 'kind',      label: '種別',       kw: ['種別', '区分', 'チェック種別', 'cp種別', 'type', '種類', 'pc'],
      avoid: /pc[～~〜間]|間|オープン|クローズ|open|close|情報|その他|備考|参考/i },
    // 「地点までの道路番号」「PC間」のような見出しを地点名と誤認しないよう avoid を持たせる
    { key: 'name',      label: '地点名',     kw: ['通過点', '地点', '名称', '場所', 'チェックポイント', 'cp名', 'ポイント名', 'point name', '店名', '通過チェック', 'name'],
      avoid: /距離|km|区間|積算|累積|合計|道路|番号|時刻|open|close|進路|情報|その他|備考|pc[～~〜間]/i },
    { key: 'dist',      label: '積算距離',   kw: ['積算', '累積', '通算', '合計', '累計', 'トータル', 'total', '積算距離', '距離(積算)', 'distance', '総距離', '距離'] },
    { key: 'segDist',   label: '区間距離',   kw: ['区間', '区間距離', 'ラップ', 'lap', '次まで', 'trip'] },
    { key: 'open',      label: 'Open',       kw: ['open', 'オープン', '開', '通過可能', 'ｵｰﾌﾟﾝ'] },
    { key: 'close',     label: 'Close',      kw: ['close', 'クローズ', '閉', '制限', 'ｸﾛｰｽﾞ', 'クローズ時刻'] },
    { key: 'direction', label: '進路',       kw: ['進路', '方向', '進行', '曲がる', '右左折', 'ターン', 'turn', 'dir'] },
    { key: 'road',      label: '道路名',     kw: ['道路', '道路名', '経路', 'ルート', '路線', 'route', 'rt', '道'] },
    { key: 'sign',      label: '道標',       kw: ['道標', '青看板', '看板', '標識', '方面'],
      avoid: /備考|情報|その他|メモ|注意|コメント/ },
    { key: 'cross',     label: '交差点の形',  kw: ['交差', '交差点', '形状', 'cr'] },
    { key: 'landmark',  label: 'ランドマーク', kw: ['目印', 'ランドマーク', '目標', '目標物'] },
    { key: 'signal',    label: '信号',       kw: ['信号', 'signal', '信号機', 'sig'] },
    { key: 'note',      label: '備考',       kw: ['備考', '情報', 'その他', '注意', 'コメント', 'メモ', '補足', '注記', 'remarks', 'guide', 'landmark'] }
  ];

  /* ---------- ワークブック読取 ---------- */
  function readWorkbook(arrayBuffer) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS(xlsx.js)が読み込まれていません');
    var wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
    return wb.SheetNames.map(function (name) {
      var ws = wb.Sheets[name];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
      // 右端の全空列を除去
      var width = 0;
      rows.forEach(function (r) {
        for (var i = r.length - 1; i >= 0; i--) {
          if (r[i] !== null && r[i] !== undefined && String(r[i]).trim() !== '') { width = Math.max(width, i + 1); break; }
        }
      });
      rows = rows.map(function (r) {
        var out = [];
        for (var i = 0; i < width; i++) out.push(r[i] === undefined ? null : r[i]);
        return out;
      });
      return { name: name, rows: rows, width: width };
    });
  }

  /* ---------- 見出し行の推定 ---------- */
  function guessHeaderRow(rows) {
    var best = { row: 0, score: -1 };
    var limit = Math.min(rows.length, 20);
    for (var r = 0; r < limit; r++) {
      var score = 0, filled = 0;
      for (var c = 0; c < rows[r].length; c++) {
        var v = U.normalizeText(rows[r][c]).toLowerCase();
        if (!v) continue;
        filled++;
        if (v.length > 20) continue; // 説明文の行は見出しではない
        ROLES.forEach(function (role) {
          role.kw.forEach(function (k) { if (v.indexOf(k) >= 0) score += 2; });
        });
      }
      score += Math.min(filled, 6) * 0.2;
      if (score > best.score) best = { row: r, score: score };
    }
    return best.score > 1 ? best.row : 0;
  }

  /**
   * 見出しが2行に分かれている表（「地点までの」の下に「区間」「積算」など）に対応する。
   * 見出し行の直後が小見出し行なら、ラベルを連結して1行の見出しとして扱う。
   * @returns {{headerRow:number, labels:Array<string>}} headerRow は見出しブロックの最終行
   */
  function resolveHeader(rows, startRow) {
    var h = (startRow === undefined) ? guessHeaderRow(rows) : startRow;
    var labels = (rows[h] || []).map(function (v) { return U.normalizeText(v); });

    for (var step = 0; step < 2; step++) {
      var next = rows[h + 1];
      if (!next) break;
      var texts = 0, numbers = 0, longText = 0;
      next.forEach(function (v) {
        if (v === null || v === undefined || String(v).trim() === '') return;
        if (typeof v === 'number') numbers++;
        else { texts++; if (U.normalizeText(v).length > 14) longText++; }
      });
      // 数値が入っている＝データ行。小見出しは短い文字列だけの行。
      if (numbers > 0 || texts < 2 || longText > 1) break;
      next.forEach(function (v, i) {
        var t = U.normalizeText(v);
        if (!t) return;
        labels[i] = labels[i] ? (labels[i] + ' ' + t) : t;
      });
      h++;
    }
    return { headerRow: h, labels: labels };
  }

  /** 見出しセルから列 → 役割 の推定マップを作る */
  function guessColumns(headerCells) {
    var map = {};
    var used = {};
    ROLES.forEach(function (role) {
      var bestCol = -1, bestScore = 0;
      headerCells.forEach(function (cell, idx) {
        if (used[idx]) return;
        var v = U.normalizeText(cell).toLowerCase();
        if (!v) return;
        var s = 0;
        role.kw.forEach(function (k) {
          if (v === k) s = Math.max(s, 10);
          else if (v.indexOf(k) >= 0) s = Math.max(s, 10 - Math.min(5, v.length - k.length));
        });
        // 「積算距離」と「区間距離」の取り違え防止
        if (role.key === 'dist' && /区間|ラップ/.test(v)) s = 0;
        if (role.key === 'segDist' && /積算|累積|通算/.test(v)) s = 0;
        if (role.avoid && role.avoid.test(v)) s = 0;
        if (s > bestScore) { bestScore = s; bestCol = idx; }
      });
      if (bestCol >= 0) { map[role.key] = bestCol; used[bestCol] = true; }
    });
    return map;
  }

  /**
   * 積算距離の列を、見出しだけでなくデータからも検証する。
   * 「ADD」「TRIP」のように見出しから判別できない書式や、区間距離を掴んでいる場合に効く。
   * @param {number} gpxTotalKm GPXの総距離（あれば精度が上がる）
   * @returns {{col:number, changed:boolean, max:number}|null}
   */
  function chooseDistColumn(rows, headerRow, colMap, gpxTotalKm) {
    var start = headerRow + 1;
    var width = 0;
    rows.forEach(function (r) { width = Math.max(width, r.length); });

    function evaluate(col) {
      var v = [];
      for (var r = start; r < rows.length; r++) {
        var x = rows[r] ? rows[r][col] : null;
        if (typeof x === 'number' && isFinite(x)) v.push(x);
        else if (typeof x === 'string' && /^\s*\d+(\.\d+)?\s*(km)?\s*$/i.test(x)) v.push(parseFloat(x));
      }
      if (v.length < 5) return null;
      for (var i = 1; i < v.length; i++) if (v[i] < v[i - 1] - 0.05) return null;   // 単調増加でないと積算ではない
      var max = v[v.length - 1];
      if (max <= 1 || max > 2000) return null;      // 日付シリアル値などを除外
      var frac = v.filter(function (x) { return Math.abs(x - Math.round(x)) > 0.01; }).length / v.length;
      var score;
      if (gpxTotalKm) {
        var err = Math.abs(max - gpxTotalKm) / gpxTotalKm;
        if (err > 0.3) return null;
        score = 1000 - err * 2000;
      } else {
        score = Math.min(max, 1500) / 10 + frac * 20;   // 値域が大きく小数を含む列ほど距離らしい
      }
      return { col: col, score: score, max: max, count: v.length };
    }

    var skip = {};
    ['no', 'open', 'close'].forEach(function (k) { if (colMap[k] !== undefined) skip[colMap[k]] = 1; });

    var current = colMap.dist !== undefined ? evaluate(colMap.dist) : null;
    var best = null;
    for (var c = 0; c < width; c++) {
      if (skip[c]) continue;
      var e = evaluate(c);
      if (e && (!best || e.score > best.score)) best = e;
    }
    if (!best) return null;
    if (current && current.col === best.col) return { col: best.col, changed: false, max: best.max };
    if (current && current.score >= best.score) return { col: current.col, changed: false, max: current.max };
    return { col: best.col, changed: colMap.dist !== best.col, max: best.max };
  }

  /* ---------- 値パーサ ---------- */
  function parseDistance(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = U.normalizeText(v).replace(/,/g, '').replace(/km|ｋｍ/gi, '');
    var m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  var EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

  /**
   * 時刻セルを解析する（絶対日時 / 日付跨ぎ表記 / 時刻のみ に正規化）
   * @returns {null|{type:'abs',wallMs:number}|{type:'tod',minutes:number}|{type:'dom',day:number,minutes:number}|{type:'md',month:number,day:number,minutes:number}}
   */
  function parseTimeCell(v) {
    if (v === null || v === undefined || v === '') return null;

    if (v instanceof Date) {
      return { type: 'abs', wallMs: Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes()) };
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      if (v >= 1000) { // 日付込みシリアル値（例 46208.005）
        return { type: 'abs', wallMs: EXCEL_EPOCH_UTC + Math.round(v * 86400) * 1000 };
      }
      // 0〜1 = 時刻、1以上 = 24時間超の時刻（[h]:mm 書式）
      return { type: 'tod', minutes: Math.round(v * 1440) };
    }

    var s = U.normalizeText(v);
    if (!s) return null;

    var dayShift = 0;
    var mm;
    // 「翌」「翌日」「2日目」「3日目」
    if (/^翌々/.test(s)) { dayShift = 2; s = s.replace(/^翌々日?/, '').trim(); }
    else if (/^翌/.test(s)) { dayShift = 1; s = s.replace(/^翌日?/, '').trim(); }
    if ((mm = s.match(/^(\d+)\s*日目/))) { dayShift = parseInt(mm[1], 10) - 1; s = s.replace(/^\d+\s*日目/, '').trim(); }

    // 「9/12 08:12」「9月12日 8:12」
    if ((mm = s.match(/^(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?\s+(\d{1,2}):(\d{2})/))) {
      return { type: 'md', month: parseInt(mm[1], 10), day: parseInt(mm[2], 10), minutes: parseInt(mm[3], 10) * 60 + parseInt(mm[4], 10) };
    }
    // 「7/0:40」（日/時刻）。月日ではなく日付＋時刻として扱う
    if ((mm = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*[:：]\s*(\d{2})$/))) {
      return { type: 'dom', day: parseInt(mm[1], 10), minutes: parseInt(mm[2], 10) * 60 + parseInt(mm[3], 10) };
    }
    // 「12日 08:12」
    if ((mm = s.match(/^(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/))) {
      return { type: 'dom', day: parseInt(mm[1], 10), minutes: parseInt(mm[2], 10) * 60 + parseInt(mm[3], 10) };
    }
    // 「08:12」「8:12」「27:30」「08時12分」
    if ((mm = s.match(/(\d{1,3})\s*[:：時]\s*(\d{1,2})/))) {
      return { type: 'tod', minutes: parseInt(mm[1], 10) * 60 + parseInt(mm[2], 10) + dayShift * 1440 };
    }
    return null;
  }

  /**
   * パース済み時刻 → 出走からの経過分に解決する（順序を使って日跨ぎを補正）
   * @param {Array} parsedList 各地点の {open, close} パース結果（コース順）
   * @param {Date}  startDate  出走日時（JSTのローカル表現）
   */
  function resolveTimes(parsedList, startDate) {
    var startWall = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(),
                             startDate.getHours(), startDate.getMinutes());
    var startMinOfDay = startDate.getHours() * 60 + startDate.getMinutes();
    // Open列・Close列はそれぞれ単調増加する。両者を混ぜて比較すると
    // 「次のCPのOpen < 前のCPのClose」で誤って1日進めてしまうため、別々に持つ。
    var prevOpen = 0, prevClose = 0;

    function resolveOne(p, floor) {
      if (!p) return null;
      if (p.type === 'abs') {
        var min = Math.round((p.wallMs - startWall) / 60000);
        // 主催者のテンプレートに古い日付が残っている場合があるので、
        // 出走日から大きく外れていたら日付は捨てて時刻だけ使う
        if (min >= -720 && min <= 43200) return min;
        var tod = Math.round((((p.wallMs % 86400000) + 86400000) % 86400000) / 60000);
        p = { type: 'tod', minutes: tod };
      }
      if (p.type === 'md' || p.type === 'dom') {
        // 出走日の前後20日から該当日を選ぶ
        var best = null, bestAbs = Infinity;
        for (var k = -20; k <= 20; k++) {
          var d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + k);
          if (d.getDate() !== p.day) continue;
          if (p.type === 'md' && (d.getMonth() + 1) !== p.month) continue;
          var wall = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + p.minutes * 60000;
          var min = Math.round((wall - startWall) / 60000);
          if (Math.abs(min) < bestAbs) { bestAbs = Math.abs(min); best = min; }
        }
        return best;
      }
      // 時刻のみ：出走時刻を基準に、前の地点より後になるよう日を送る
      var m = p.minutes - startMinOfDay;
      while (m < floor - 1) m += 1440;
      return m;
    }

    return parsedList.map(function (row) {
      var open = resolveOne(row.open, prevOpen);
      var close = resolveOne(row.close, open != null ? Math.max(prevClose, open) : prevClose);
      if (open != null) prevOpen = open;
      if (close != null) { prevClose = close; if (open == null) prevOpen = Math.max(prevOpen, close - 1440); }
      return { open: open, close: close };
    });
  }

  /* ---------- 行のどこかにあるCP表記を拾う ---------- */
  // 「PC1 セイコーマート木古内」「通過C1海のプール入口」「START 元町公園前」など、
  // 主催者によっては地点名の列が無く、道標欄などにCP名が書かれている。
  // 「左側　PC1  セブンイレブン…」のように前置きがある書式もあるため、
  // 行頭に限定せず、語として独立しているCP表記を探す。
  // PC/CPは番号付きのときだけ拾う（「PCを通過」のような文章に反応しないように）
  var CP_MARK = /(^|[\s　\/／・（(【\[])(start|goal|finish|ゴール|スタート|pc\s*\d+|cp\s*\d+|control\s*\d+|コントロール\s*\d+|通過c\s*\d*|通過チェック\s*\d*|フォトチェック\s*\d*)([\s　:：・]*)/i;

  /** CP名の後ろに続く注記（レシート取得、OPEN…など）を落として地点名だけにする */
  function trimCpName(text) {
    var t = U.normalizeText(String(text || ''));
    // 注記が始まるところで切る（改行は主催者によって位置がまちまちなので使わない）
    t = t.replace(/\s*[［\[（(]?\s*(参考\s*)?(open|close)[\s\S]*$/i, '');
    t = t.replace(/\s*(コントロール[。．]|レシート|写真を?撮影|目標物撮影|カード提示|フォトチェック|通過時間)[\s\S]*$/, '');
    t = t.replace(/[。．][\s\S]*$/, '');
    return t.trim();
  }

  /** 「OPEN 9：14/CLOSE 13：20」のような文中の時刻を拾う */
  function parseTimesInText(text) {
    if (!text) return { open: null, close: null };
    var t = U.normalizeText(String(text).replace(/[\r\n]/g, ' '));
    function pick(word) {
      var m = t.match(new RegExp(word + '[^0-9]{0,6}(\\d{1,2})\\s*[:：時]\\s*(\\d{2})', 'i'));
      return m ? { type: 'tod', minutes: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) } : null;
    }
    var o = pick('open'), c = pick('close');
    if (o || c) return { open: o, close: c };

    // 「06:00～06:30」「7:16〜9:09」「14:36～26日1:24」のような範囲表記
    var m2 = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[〜～~ー－-]\s*(?:(\d{1,2})\s*日\s*)?(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!m2) return { open: null, close: null };
    var close = { type: 'tod', minutes: parseInt(m2[4], 10) * 60 + parseInt(m2[5], 10) };
    if (m2[3]) close = { type: 'dom', day: parseInt(m2[3], 10), minutes: close.minutes };
    return {
      open: { type: 'tod', minutes: parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10) },
      close: close
    };
  }

  /** 行のどこかにある時刻範囲を拾う（時刻列が無い書式向け） */
  function findTimesInRow(row, skipCol) {
    // まずは1セルの中に範囲や OPEN/CLOSE が書かれている形式
    for (var i = 0; i < row.length; i++) {
      if (i === skipCol) continue;
      if (typeof row[i] !== 'string') continue;
      var r = parseTimesInText(row[i]);
      if (r.open || r.close) return r;
    }
    // 次に「参考10:45」「参考11:45」のように単独時刻が別々の列に入っている形式
    var found = [];
    for (var j = 0; j < row.length; j++) {
      if (j === skipCol) continue;
      if (typeof row[j] !== 'string') continue;
      var cell = U.normalizeText(row[j]);
      var md = cell.match(/(\d{1,2})\s*[\/日]\s*(\d{1,2})\s*[:：]\s*(\d{2})(?![\d:：])/);
      if (md) {
        found.push({ type: 'dom', day: parseInt(md[1], 10), minutes: parseInt(md[2], 10) * 60 + parseInt(md[3], 10) });
      } else {
        var m = cell.match(/(?:^|[^\d])(\d{1,2})\s*[:：]\s*(\d{2})(?![\d:：])/);
        if (m) found.push({ type: 'tod', minutes: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) });
      }
      if (found.length === 2) break;
    }
    if (found.length === 2) return { open: found[0], close: found[1] };
    if (found.length === 1) return { open: null, close: null, single: found[0] };
    return { open: null, close: null };
  }

  function findCpCell(row) {
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (typeof v !== 'string') continue;
      var raw = String(v);
      var t = U.normalizeText(raw);
      if (!t || t.length > 120) continue;
      var m = t.match(CP_MARK);
      if (!m) continue;
      var kind = detectKind(m[2], '');
      if (!kind) continue;
      var rest = t.slice(m.index + m[0].length);
      var name = trimCpName(rest);
      var after = name ? rest.slice(rest.indexOf(name) + name.length).trim() : rest;
      // 時刻はチップで表示するので、備考からは「［参考 OPEN…/CLOSE…］」を取り除く
      after = after.replace(/[［\[（(]?\s*(参考)?\s*open[^）)］\]]*?(close[^）)］\]]*)?[）)］\]]?\s*$/i, '').trim();
      return {
        col: i, text: t, raw: raw,
        marker: m[2].trim(),
        name: name,
        after: after,                      // 「レシート取得 ［参考 OPEN…］」など
        times: parseTimesInText(raw)
      };
    }
    return null;
  }

  /* ---------- 地点種別の判定 ---------- */
  function detectKind(kindText, nameText) {
    var s = (U.normalizeText(kindText) + ' ' + U.normalizeText(nameText)).toLowerCase();
    if (!s.trim()) return null;
    if (/(^|[^a-z])goal|ゴール|finish|フィニッシュ/.test(s)) return 'goal';
    if (/start|スタート|出発/.test(s)) return 'start';
    if (/クイズ|問題/.test(s)) return 'quiz';
    if (/通過|フォト|写真|photo/.test(s)) return 'pass';
    if (/\bpc\d*\b|pc\s*\d|control|ポイントコントロール|コントロール|レシート/.test(s)) return 'pc';
    return null;
  }

  /** 「PC1」「通過C2」などのラベル抽出 */
  function extractLabel(kind, nameText, seqCounters) {
    var s = U.normalizeText(nameText);
    var m = s.match(/(PC|ＰＣ|通過C|通過チェック|CP)\s*(\d+)/i);
    if (m) return m[0].replace(/\s+/g, '');
    if (kind === 'start') return 'Start';
    if (kind === 'goal') return 'Goal';
    if (kind === 'pc') return 'PC' + (++seqCounters.pc);
    if (kind === 'pass' || kind === 'quiz') return '通過C' + (++seqCounters.pass);
    return '';
  }

  NS.xlsxImport = {
    ROLES: ROLES,
    readWorkbook: readWorkbook,
    guessHeaderRow: guessHeaderRow,
    resolveHeader: resolveHeader,
    chooseDistColumn: chooseDistColumn,
    findCpCell: findCpCell,
    findTimesInRow: findTimesInRow,
    parseTimesInText: parseTimesInText,
    guessColumns: guessColumns,
    parseDistance: parseDistance,
    parseTimeCell: parseTimeCell,
    resolveTimes: resolveTimes,
    detectKind: detectKind,
    extractLabel: extractLabel
  };
})(BCG);
