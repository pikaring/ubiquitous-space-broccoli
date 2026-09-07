/* 生成ツールのUI制御 */
(function (NS) {
  'use strict';
  var U = NS.util, X = NS.xlsxImport;

  var state = { track: null, sheets: [], model: null, html: null, blobUrl: null };

  function $(id) { return document.getElementById(id); }
  function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
  function colName(i) {
    var s = '';
    i = i + 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  /* ================= ファイル読み込み ================= */
  function setupDrop(dropId, inputId, handler) {
    var drop = $(dropId), input = $(inputId);
    input.addEventListener('change', function () { if (input.files[0]) handler(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (f) handler(f);
    });
  }

  function loadGpxFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        applyGpx(fr.result, file.name);
      } catch (err) { showError('GPXの読み込みに失敗しました：' + err.message); }
    };
    fr.readAsText(file);
  }

  function applyGpx(text, filename) {
    state.track = NS.gpx.parseGpx(text);
    $('status-gpx').textContent = filename + '（' + state.track.pts.length.toLocaleString() + '点 / ' +
      state.track.totalKm.toFixed(1) + 'km）';
    $('drop-gpx').classList.add('loaded');
    renderGpxSummary();
    if (!$('opt-title').value && state.track.name) $('opt-title').value = state.track.name;
    guessEventDateTime();
    show('step3', true);
  }

  function loadXlsxFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        applyWorkbook(fr.result, file.name);
      } catch (err) { showError('Excelの読み込みに失敗しました：' + err.message); }
    };
    fr.readAsArrayBuffer(file);
  }

  function applyWorkbook(buffer, filename) {
    var sheets = X.readWorkbook(buffer);
    state.sheets = sheets.map(function (s) {
      var headerRow = X.guessHeaderRow(s.rows);
      var colMap = X.guessColumns(s.rows[headerRow] || []);
      return { name: s.name, rows: s.rows, headerRow: headerRow, colMap: colMap, role: guessRole(s.name, colMap) };
    });
    $('status-xlsx').textContent = filename + '（' + sheets.length + 'シート）';
    $('drop-xlsx').classList.add('loaded');
    renderSheets();
    show('step2', true);
    show('step3', true);
    if (!$('opt-title').value) {
      var t = sheets[0] && sheets[0].rows[0] && sheets[0].rows[0].find(function (c) { return c && String(c).length > 4; });
      if (t) $('opt-title').value = U.normalizeText(t);
    }
    guessEventDateTime();
  }

  function guessRole(sheetName, colMap) {
    var n = U.normalizeText(sheetName);
    if (/簡易|概要|summary/i.test(n)) return 'simple';
    if (/詳細|キューシート|cue|detail/i.test(n)) return 'detail';
    if (/説明|注意|案内|regulation|readme|コース情報/i.test(n)) return 'ignore';
    if (colMap.direction !== undefined || colMap.road !== undefined || colMap.landmark !== undefined) return 'detail';
    if (colMap.close !== undefined || colMap.open !== undefined) return 'simple';
    if (colMap.dist === undefined) return 'ignore';
    return 'simple';
  }

  /* 大会名・Excelから出走日時を推測 */
  function guessEventDateTime() {
    var title = $('opt-title').value || '';
    if (!$('opt-date').value) {
      var m = title.match(/(20\d{2})?\s*BRM\s*(\d{3,4})/i);
      if (m) {
        var digits = m[2];
        var mo = digits.length === 3 ? parseInt(digits[0], 10) : parseInt(digits.slice(0, 2), 10);
        var da = digits.length === 3 ? parseInt(digits.slice(1), 10) : parseInt(digits.slice(2), 10);
        var yr = m[1] ? parseInt(m[1], 10) : new Date().getFullYear();
        if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
          $('opt-date').value = yr + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
        }
      }
    }
    // Start地点のOpen時刻を出走時刻の初期値にする
    var simple = state.sheets.filter(function (s) { return s.role === 'simple'; })[0] ||
                 state.sheets.filter(function (s) { return s.role === 'detail'; })[0];
    if (!simple) return;
    var recs = NS.match.extractRecords(simple);
    var startRec = recs.filter(function (r) { return r.kind === 'start' || r.dist === 0; })[0];
    if (startRec) {
      var t = startRec.openRaw || startRec.closeRaw;
      if (t && t.type === 'tod' && !$('opt-time').dataset.touched) {
        $('opt-time').value = String(Math.floor(t.minutes / 60)).padStart(2, '0') + ':' +
                             String(t.minutes % 60).padStart(2, '0');
      }
      if (t && t.type === 'abs' && !$('opt-date').value) {
        var d = new Date(t.wallMs);
        $('opt-date').value = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
        $('opt-time').value = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
      }
    }
  }

  /* ================= 表示 ================= */
  function renderGpxSummary() {
    var t = state.track;
    var wpts = t.waypoints.filter(function (w) { return w.name; });
    $('gpx-summary').innerHTML =
      '<dl>' +
      '<dt>トラック名</dt><dd>' + U.escapeHtml(t.name || '（なし）') + '</dd>' +
      '<dt>総距離</dt><dd>' + t.totalKm.toFixed(2) + ' km</dd>' +
      '<dt>トラックポイント</dt><dd>' + t.pts.length.toLocaleString() + ' 点（平均間隔 ' +
        (t.totalKm * 1000 / Math.max(1, t.pts.length - 1)).toFixed(1) + ' m）</dd>' +
      '<dt>ウェイポイント</dt><dd>' + wpts.length + ' 件' +
        (wpts.length ? '：' + U.escapeHtml(wpts.slice(0, 6).map(function (w) { return w.name; }).join(' / ')) +
          (wpts.length > 6 ? ' …' : '') : '') + '</dd>' +
      '</dl>';
    show('gpx-summary', true);
  }

  function renderSheets() {
    var host = $('sheets');
    host.innerHTML = '';
    state.sheets.forEach(function (sheet, si) {
      var box = document.createElement('div');
      box.className = 'sheet';
      box.innerHTML =
        '<div class="sheet-head">' +
          '<span class="sheet-name">' + U.escapeHtml(sheet.name) + ' <span class="note">（' + sheet.rows.length + '行）</span></span>' +
          '<span class="sheet-role">このシートを' +
            '<select data-role="' + si + '">' +
              '<option value="simple">簡易（CP一覧）として使う</option>' +
              '<option value="detail">詳細（曲がり角）として使う</option>' +
              '<option value="ignore">使わない</option>' +
            '</select>' +
          '</span>' +
        '</div>' +
        '<div class="map-body"></div>';
      host.appendChild(box);
      box.querySelector('[data-role]').value = sheet.role;
      box.querySelector('[data-role]').addEventListener('change', function (e) {
        sheet.role = e.target.value;
        renderSheetBody(sheet, si, box.querySelector('.map-body'));
      });
      renderSheetBody(sheet, si, box.querySelector('.map-body'));
    });
  }

  function renderSheetBody(sheet, si, host) {
    if (sheet.role === 'ignore') { host.innerHTML = ''; return; }
    var header = sheet.rows[sheet.headerRow] || [];
    var opts = '<option value="">（なし）</option>' + header.map(function (h, i) {
      return '<option value="' + i + '">' + colName(i) + '列：' + U.escapeHtml(U.normalizeText(h) || '（無題）') + '</option>';
    }).join('');
    var roleFields = X.ROLES.filter(function (r) {
      if (sheet.role === 'simple') return ['name', 'dist', 'segDist', 'open', 'close', 'kind', 'note'].indexOf(r.key) >= 0;
      return true;
    });
    host.innerHTML =
      '<div class="map-grid">' +
        '<label>見出し行（1始まり）<input type="number" min="1" max="' + sheet.rows.length + '" value="' + (sheet.headerRow + 1) + '" data-header="' + si + '"></label>' +
        roleFields.map(function (r) {
          return '<label>' + r.label + '<select data-col="' + r.key + '">' + opts + '</select></label>';
        }).join('') +
      '</div>' +
      '<div class="tablewrap"></div>';

    roleFields.forEach(function (r) {
      var sel = host.querySelector('[data-col="' + r.key + '"]');
      sel.value = (sheet.colMap[r.key] === undefined) ? '' : String(sheet.colMap[r.key]);
      sel.addEventListener('change', function () {
        if (sel.value === '') delete sheet.colMap[r.key];
        else sheet.colMap[r.key] = parseInt(sel.value, 10);
        renderPreviewTable(sheet, host.querySelector('.tablewrap'));
      });
    });
    host.querySelector('[data-header]').addEventListener('change', function (e) {
      sheet.headerRow = Math.max(0, parseInt(e.target.value, 10) - 1);
      sheet.colMap = X.guessColumns(sheet.rows[sheet.headerRow] || []);
      renderSheetBody(sheet, si, host);
    });
    renderPreviewTable(sheet, host.querySelector('.tablewrap'));
  }

  function renderPreviewTable(sheet, host) {
    var width = 0;
    sheet.rows.forEach(function (r) { width = Math.max(width, r.length); });
    var mappedCols = {};
    Object.keys(sheet.colMap).forEach(function (k) { mappedCols[sheet.colMap[k]] = k; });
    var head = '<tr><th>行</th>';
    for (var c = 0; c < width; c++) {
      head += '<th>' + colName(c) + (mappedCols[c] ? '<br><span style="color:var(--accent-2)">' +
        (X.ROLES.filter(function (r) { return r.key === mappedCols[c]; })[0] || {}).label + '</span>' : '') + '</th>';
    }
    head += '</tr>';
    var body = '';
    var from = Math.max(0, sheet.headerRow), to = Math.min(sheet.rows.length, from + 9);
    for (var r2 = from; r2 < to; r2++) {
      body += '<tr class="' + (r2 === sheet.headerRow ? 'headerrow' : '') + '"><td>' + (r2 + 1) + '</td>';
      for (var c2 = 0; c2 < width; c2++) {
        var v = sheet.rows[r2][c2];
        body += '<td class="' + (mappedCols[c2] ? 'mapped' : '') + '">' + U.escapeHtml(v === null || v === undefined ? '' : v) + '</td>';
      }
      body += '</tr>';
    }
    host.innerHTML = '<table class="preview"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  /* ================= 生成 ================= */
  function showError(msg) {
    $('gen-error').classList.remove('warn');
    $('gen-error').textContent = msg;
    show('gen-error', true);
  }

  function generate() {
    show('gen-error', false);
    if (!state.track) { showError('GPXファイルを読み込んでください。'); return; }
    var dateVal = $('opt-date').value;
    var timeVal = $('opt-time').value || '07:00';
    if (!dateVal) { showError('出走日を入力してください（Open/Closeの日跨ぎ判定に使います）。'); return; }
    var startDate = new Date(dateVal + 'T' + timeVal + ':00');

    var opt = {
      title: $('opt-title').value || 'ブルベ キューシート',
      startDate: startDate,
      speed: parseInt($('opt-speed').value, 10) || 18,
      totalKmOverride: parseFloat($('opt-total').value) || null,
      snapWaypoints: $('opt-snap').checked,
      acpFallback: $('opt-acp').checked,
      timeLimitMin: parseFloat($('opt-limit').value) ? Math.round(parseFloat($('opt-limit').value) * 60) : null,
      autoTurns: $('opt-autoturns').checked,
      turnOpts: { minAngle: parseInt($('opt-angle').value, 10) || 50 },
      embedWx: $('opt-embed-wx').checked,
      embedMap: $('opt-embed-map').value
    };
    try {
      var model = NS.match.buildCourse(state.track, state.sheets, opt);
      if (!model.cps.length) {
        showError('CP（PC・通過チェック・Start/Goal）が1つも見つかりませんでした。\n' +
          'STEP2で「地点名」「積算距離」の列が正しく割り当てられているか確認してください。');
        return;
      }
      var notes = (model.notices || []).slice();
      if (model.meta.cpFromGpx) notes.push('ExcelのCPが無いため、GPXのウェイポイントと始終点からCPを構成しました。');
      if (model.meta.acpTimes) notes.push('Open/CloseはACP基準で補完した地点があります（主催者の公式時刻で必ず確認してください）。');
      if (model.meta.autoTurns) notes.push('曲がり角はGPXの方位変化から自動抽出しました（道路名・ランドマークは入りません）。');
      state.model = model;

      // オフライン用の焼き込み（天気・地図）→ 完了後にHTMLを組み立てる
      $('btn-generate').disabled = true;
      buildOffline(model, opt, notes).then(function () {
        state.html = NS.template.buildHtml(model);
        renderOutput();
        show('gen-progress', false);
        $('btn-generate').disabled = false;
        if (notes.length) {
          $('gen-error').textContent = '⚠️ ' + notes.join('\n⚠️ ');
          $('gen-error').classList.add('warn');
          show('gen-error', true);
        }
        show('step4', true);
        $('step4').scrollIntoView({ behavior: 'smooth' });
      }).catch(function (err) {
        $('btn-generate').disabled = false;
        show('gen-progress', false);
        showError('生成中にエラーが発生しました：' + err.message);
        if (window.console) console.error(err);
      });
    } catch (err) {
      showError('生成中にエラーが発生しました：' + err.message);
      if (window.console) console.error(err);
    }
  }

  /* ---- オフライン用の焼き込み ---- */
  function progress(msg) {
    $('gen-progress').textContent = msg;
    show('gen-progress', true);
  }

  function buildOffline(model, opt, notes) {
    var offline = {};
    var jobs = [];

    if (opt.embedWx) {
      progress('天気予報を取得しています…');
      var pts = NS.offline.sampleWeatherPoints(model.cues, 20);
      var goal = model.cps[model.cps.length - 1];
      var span = (goal && goal.closeMin) || Math.round(model.meta.totalKm / 12 * 60);
      jobs.push(
        NS.offline.fetchWeather(pts, opt.startDate, span).then(function (wx) {
          if (wx) offline.wx = wx;
          else notes.push('開催日が予報範囲（今日〜16日後）の外なので、天気は埋め込みませんでした。開催が近づいてから生成し直すと埋め込めます。');
        }).catch(function (e) {
          notes.push('天気の埋め込みに失敗しました（' + e.message + '）。閲覧時に通信できる環境なら、その場で取得されます。');
        })
      );
    }

    // ルート略図は全地点ぶん入れても数十KBなので常に埋め込む（地図タイルと同じ縮尺で描く）
    var mapZoom = parseInt($('opt-embed-zoom').value, 10) || 16;
    var sketchTargets = model.cues.map(function (c, i) {
      return { id: 'q' + i, lat: c.lat, lon: c.lon, gpxKm: c.gpxKm };
    });
    offline.sketch = {
      z: mapZoom,
      paths: NS.offline.buildSketches(state.track, sketchTargets, mapZoom, 250, 20)
    };

    if (opt.embedMap && opt.embedMap !== 'none') {
      var targets = model.cues.map(function (c, i) {
        return { id: 'q' + i, lat: c.lat, lon: c.lon, kind: c.kind };
      }).filter(function (t) {
        return t.lat != null && (opt.embedMap === 'all' || t.kind !== 'turn');
      });
      var plan = NS.offline.planTiles(targets, mapZoom);
      if (plan.outside) notes.push('日本国外の' + plan.outside + '地点は地図を埋め込めませんでした（地理院タイルの範囲外）。');
      if (plan.keys.length) {
        progress('地図タイルを取得しています… 0/' + plan.keys.length);
        jobs.push(
          NS.offline.fetchTiles(plan.keys, function (done, total) {
            progress('地図タイルを取得しています… ' + done + '/' + total);
          }).then(function (res) {
            offline.map = {
              w: NS.offline.MAP_W, h: NS.offline.MAP_H, attr: NS.offline.TILE_ATTR,
              layout: plan.layout, tiles: res.tiles
            };
            if (res.failed) notes.push('地図タイル ' + res.failed + '枚を取得できませんでした（その部分は空欄になります）。');
          })
        );
      }
    }

    model.offline = offline;
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs).then(function () {
      progress('HTMLを組み立てています…');
    });
  }

  function renderOutput() {
    var blob = new Blob([state.html], { type: 'text/html;charset=utf-8' });
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = URL.createObjectURL(blob);
    $('preview').src = state.blobUrl;
    var off = state.model.offline || {};
    var extra = [];
    if (off.wx) extra.push('天気' + off.wx.points.length + '地点×' + off.wx.time.length + '時間を埋め込み');
    if (off.map) extra.push('地図' + Object.keys(off.map.tiles).length + 'タイルを埋め込み');
    if (off.sketch) extra.push('ルート略図' + Object.keys(off.sketch.paths).length + '地点');
    var size = blob.size >= 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : (blob.size / 1024).toFixed(0) + ' KB';
    $('filesize').textContent = '生成サイズ ' + size + ' / ' +
      state.model.cps.length + 'CP・' + state.model.cues.length + '行' +
      (extra.length ? ' / ' + extra.join('・') : '');
    show('size-warn', blob.size > 4 * 1048576);

    var rows = state.model.report.map(function (r) {
      return '<tr><td>' + U.escapeHtml(r.kind) + '</td><td>' + U.escapeHtml(r.label) + '</td>' +
        '<td>' + U.escapeHtml(r.name) + '</td><td>' + r.distKm.toFixed(1) + '</td>' +
        '<td>' + r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) + '</td><td>' + r.bearing + '°</td>' +
        '<td>' + U.escapeHtml(r.source) + (r.snapMoveM ? '（' + r.snapMoveM + 'm移動）' : '') + '</td></tr>';
    }).join('');
    $('report').innerHTML =
      '<p class="note">キューシート総距離 ' + state.model.meta.totalKm + 'km ÷ GPX総距離 ' +
      state.model.meta.gpxTotalKm + 'km ＝ 補正係数 ' + state.model.meta.scale + '</p>' +
      '<table><thead><tr><th>種別</th><th>ラベル</th><th>名称</th><th>km</th><th>座標</th><th>方位</th><th>取得方法</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function download() {
    if (!state.html) return;
    var name = ($('opt-title').value || 'cuesheet').replace(/[\\\/:*?"<>|\s]+/g, '_');
    var a = document.createElement('a');
    a.href = state.blobUrl;
    a.download = name + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ================= サンプル ================= */
  function loadSample() {
    show('gen-error', false);
    Promise.all([
      fetch('samples/demo.gpx').then(function (r) { if (!r.ok) throw new Error('demo.gpx'); return r.text(); }),
      fetch('samples/demo.xlsx').then(function (r) { if (!r.ok) throw new Error('demo.xlsx'); return r.arrayBuffer(); })
    ]).then(function (res) {
      applyGpx(res[0], 'demo.gpx');
      applyWorkbook(res[1], 'demo.xlsx');
    }).catch(function (e) {
      showError('サンプルの読み込みに失敗しました（' + e.message + '）。\n' +
        'file:// で開いている場合はサンプルを取得できません。ローカルサーバ（例: python3 -m http.server）経由で開いてください。');
      show('step3', true);
    });
  }

  function reset() {
    state = { track: null, sheets: [], model: null, html: null, blobUrl: null };
    ['step2', 'step4', 'gpx-summary', 'gen-error'].forEach(function (id) { show(id, false); });
    $('status-gpx').textContent = '未読込';
    $('status-xlsx').textContent = '未読込';
    $('drop-gpx').classList.remove('loaded');
    $('drop-xlsx').classList.remove('loaded');
    $('file-gpx').value = ''; $('file-xlsx').value = '';
    $('sheets').innerHTML = '';
  }

  /* ================= 初期化 ================= */
  document.addEventListener('DOMContentLoaded', function () {
    setupDrop('drop-gpx', 'file-gpx', loadGpxFile);
    setupDrop('drop-xlsx', 'file-xlsx', loadXlsxFile);
    $('btn-generate').addEventListener('click', generate);
    $('btn-download').addEventListener('click', download);
    $('btn-open').addEventListener('click', function () { if (state.blobUrl) window.open(state.blobUrl, '_blank'); });
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-reset').addEventListener('click', reset);
    $('opt-time').addEventListener('input', function () { $('opt-time').dataset.touched = '1'; });
    $('opt-title').addEventListener('change', guessEventDateTime);
  });

  NS.app = { state: state, generate: generate };
})(BCG);
