/* Excelキューシート取り込み：シート読取・見出し推定・列推定・値パーサ
   主催者ごとに形式差が大きいため「自動推定＋UIで確認」を前提にする */
(function (NS) {
  'use strict';
  var U = NS.util;

  /* ---------- 列の役割と推定キーワード ---------- */
  var ROLES = [
    { key: 'no',        label: 'No.',        kw: ['no', 'no.', '№', '番号', '番'] },
    { key: 'kind',      label: '種別',       kw: ['種別', '区分', 'チェック種別', 'cp種別', 'type', '種類'] },
    { key: 'name',      label: '地点名',     kw: ['地点', '名称', '場所', 'チェックポイント', 'cp名', 'ポイント', '店名', 'pc', '通過チェック', 'name'] },
    { key: 'dist',      label: '積算距離',   kw: ['積算', '累積', '通算', 'total', '積算距離', '距離(積算)', 'distance', '距離'] },
    { key: 'segDist',   label: '区間距離',   kw: ['区間', '区間距離', 'ラップ', 'lap', '次まで'] },
    { key: 'open',      label: 'Open',       kw: ['open', 'オープン', '開', '通過可能', 'ｵｰﾌﾟﾝ'] },
    { key: 'close',     label: 'Close',      kw: ['close', 'クローズ', '閉', '制限', 'ｸﾛｰｽﾞ', 'クローズ時刻'] },
    { key: 'direction', label: '進路',       kw: ['進路', '方向', '進行', '曲がる', '右左折', 'ターン', 'turn'] },
    { key: 'road',      label: '道路名',     kw: ['道路', '道路名', '経路', 'ルート', '路線', '道'] },
    { key: 'landmark',  label: 'ランドマーク', kw: ['目印', 'ランドマーク', '目標', '交差点', '目標物'] },
    { key: 'signal',    label: '信号',       kw: ['信号', 'signal', '信号機'] },
    { key: 'note',      label: '備考',       kw: ['備考', '注意', 'コメント', 'メモ', '補足', '注記', 'remarks'] }
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
        if (s > bestScore) { bestScore = s; bestCol = idx; }
      });
      if (bestCol >= 0) { map[role.key] = bestCol; used[bestCol] = true; }
    });
    return map;
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
      if (p.type === 'abs') return Math.round((p.wallMs - startWall) / 60000);
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

  /* ---------- 地点種別の判定 ---------- */
  function detectKind(kindText, nameText) {
    var s = (U.normalizeText(kindText) + ' ' + U.normalizeText(nameText)).toLowerCase();
    if (!s.trim()) return null;
    if (/(^|[^a-z])goal|ゴール|finish|フィニッシュ/.test(s)) return 'goal';
    if (/start|スタート|出発/.test(s)) return 'start';
    if (/クイズ|問題/.test(s)) return 'quiz';
    if (/通過|フォト|写真|photo/.test(s)) return 'pass';
    if (/\bpc\d*\b|pc\s*\d|ポイントコントロール|コントロール|レシート/.test(s)) return 'pc';
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
    guessColumns: guessColumns,
    parseDistance: parseDistance,
    parseTimeCell: parseTimeCell,
    resolveTimes: resolveTimes,
    detectKind: detectKind,
    extractLabel: extractLabel
  };
})(BCG);
