/* オフライン埋め込み：生成時に天気予報と地図画像を取得してHTMLへ焼き込む
   iOSのChrome/Edgeは端末内のファイルから外部通信できないため、
   閲覧時ではなく生成時に取得しておく必要がある。 */
(function (NS) {
  'use strict';
  var U = NS.util;

  var TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
  var TILE_ATTR = '地理院タイル（国土地理院）';
  var MAP_W = 320, MAP_H = 192;      // 埋め込み地図の表示サイズ(px)
  var JP_BBOX = { latMin: 20, latMax: 46.5, lonMin: 122, lonMax: 154 };

  /* ---------- 天気 ---------- */

  /** コース上からおよそeveryKmごとに予報の取得地点を選ぶ */
  function sampleWeatherPoints(cues, everyKm) {
    var step = everyKm || 20;
    var out = [], last = -Infinity;
    cues.forEach(function (c) {
      if (c.lat == null || c.lon == null) return;
      if (c.distKm - last >= step || !out.length) {
        out.push({ lat: Math.round(c.lat * 10000) / 10000, lon: Math.round(c.lon * 10000) / 10000, km: c.distKm });
        last = c.distKm;
      }
    });
    var lastCue = cues[cues.length - 1];
    if (lastCue && out.length && out[out.length - 1].km < lastCue.distKm - 1) {
      out.push({ lat: lastCue.lat, lon: lastCue.lon, km: lastCue.distKm });
    }
    return out;
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * 予報を取得する。開催日が予報範囲（今日〜16日後）から外れる場合はnullを返す。
   * @returns {Promise<null|{fetchedAt,time,points}>}
   */
  function fetchWeather(points, startDate, spanMinutes) {
    if (!points.length) return Promise.resolve(null);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day0 = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    var days = Math.ceil((spanMinutes + 360) / 1440);          // 走行時間＋予備6時間
    var end = new Date(day0.getTime() + days * 86400000);
    var maxEnd = new Date(today.getTime() + 15 * 86400000);
    if (day0 < today) return Promise.resolve(null);            // 過去日
    if (day0 > maxEnd) return Promise.resolve(null);           // 予報範囲外
    if (end > maxEnd) end = maxEnd;

    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + points.map(function (p) { return p.lat; }).join(',') +
      '&longitude=' + points.map(function (p) { return p.lon; }).join(',') +
      '&hourly=temperature_2m,precipitation,windspeed_10m,winddirection_10m' +
      '&timezone=Asia%2FTokyo&start_date=' + ymd(day0) + '&end_date=' + ymd(end);

    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('天気APIがHTTP ' + r.status + 'を返しました');
      return r.json();
    }).then(function (data) {
      var list = Array.isArray(data) ? data : [data];
      var r1 = function (v) { return v == null ? null : Math.round(v * 10) / 10; };
      return {
        fetchedAt: new Date().toISOString(),
        time: list[0].hourly.time,
        points: list.map(function (d, i) {
          return {
            lat: points[i] ? points[i].lat : d.latitude,
            lon: points[i] ? points[i].lon : d.longitude,
            t: d.hourly.temperature_2m.map(r1),
            p: d.hourly.precipitation.map(r1),
            ws: d.hourly.windspeed_10m.map(r1),
            wd: d.hourly.winddirection_10m.map(function (v) { return v == null ? null : Math.round(v); })
          };
        })
      };
    });
  }

  /* ---------- 地図タイル ---------- */

  function lonToWorldX(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function latToWorldY(lat, z) {
    var s = Math.sin(U.toRad(lat));
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
  }

  function inJapan(lat, lon) {
    return lat >= JP_BBOX.latMin && lat <= JP_BBOX.latMax && lon >= JP_BBOX.lonMin && lon <= JP_BBOX.lonMax;
  }

  /** 各地点の地図レイアウトと、必要なタイルの一覧を作る */
  function planTiles(points, z) {
    var layout = {}, keys = {}, outside = 0;
    points.forEach(function (pt) {
      if (pt.lat == null || pt.lon == null) return;
      if (!inJapan(pt.lat, pt.lon)) { outside++; return; }
      var cx = lonToWorldX(pt.lon, z), cy = latToWorldY(pt.lat, z);
      var left = cx - MAP_W / 2, top = cy - MAP_H / 2;
      var x0 = Math.floor(left / 256), x1 = Math.floor((left + MAP_W - 1) / 256);
      var y0 = Math.floor(top / 256), y1 = Math.floor((top + MAP_H - 1) / 256);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) keys[z + '/' + x + '/' + y] = 1;
      layout[pt.id] = { z: z, cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10 };
    });
    return { layout: layout, keys: Object.keys(keys), outside: outside };
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('タイルの読み込みに失敗しました')); };
      fr.readAsDataURL(blob);
    });
  }

  /** タイルをdata URIとして取得する（同時4本まで。地理院タイルへの負荷を抑える） */
  function fetchTiles(keys, onProgress) {
    var tiles = {}, done = 0, i = 0, failed = 0;
    function next() {
      if (i >= keys.length) return Promise.resolve();
      var key = keys[i++];
      var parts = key.split('/');
      var url = TILE_URL.replace('{z}', parts[0]).replace('{x}', parts[1]).replace('{y}', parts[2]);
      return fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(blobToDataUrl)
        .then(function (d) { tiles[key] = d; })
        .catch(function () { failed++; })      // 欠けたタイルは空欄で表示する
        .then(function () {
          done++;
          if (onProgress) onProgress(done, keys.length);
          return next();
        });
    }
    var workers = [];
    for (var w = 0; w < Math.min(4, keys.length); w++) workers.push(next());
    return Promise.all(workers).then(function () { return { tiles: tiles, failed: failed }; });
  }

  /* ---------- ルート略図（GPXの線形をその場で描く。タイル不要・極小） ---------- */

  /**
   * 各地点の前後halfMメートルのコース形状を、地図と同じ座標系（zの世界ピクセル）の
   * 相対座標で書き出す。1地点あたり数百バイト。
   */
  function buildSketches(track, targets, z, halfM, stepM) {
    var half = halfM || 250, step = stepM || 20;
    var totalM = track.cum[track.cum.length - 1];
    var paths = {};
    targets.forEach(function (t) {
      if (t.gpxKm == null || t.lat == null) return;
      var cx = lonToWorldX(t.lon, z), cy = latToWorldY(t.lat, z);
      var center = t.gpxKm * 1000;
      var pts = [];
      for (var d = center - half; d <= center + half; d += step) {
        if (d < 0 || d > totalM) continue;
        var p = NS.gpx.locateAtKm(track, d / 1000);
        pts.push([
          Math.round((lonToWorldX(p.lon, z) - cx) * 10) / 10,
          Math.round((latToWorldY(p.lat, z) - cy) * 10) / 10
        ]);
      }
      if (pts.length > 1) paths[t.id] = pts;
    });
    return paths;
  }

  NS.offline = {
    sampleWeatherPoints: sampleWeatherPoints,
    buildSketches: buildSketches,
    fetchWeather: fetchWeather,
    planTiles: planTiles,
    fetchTiles: fetchTiles,
    inJapan: inJapan,
    MAP_W: MAP_W, MAP_H: MAP_H,
    TILE_ATTR: TILE_ATTR, TILE_URL: TILE_URL
  };
})(BCG);
