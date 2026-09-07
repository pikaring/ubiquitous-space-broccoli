/* GPXパーサ：トラックポイント列 → 累積距離・座標補間・方位角 */
(function (NS) {
  'use strict';
  var U = NS.util;

  function textOf(el, tags) {
    for (var i = 0; i < tags.length; i++) {
      var n = el.getElementsByTagName(tags[i])[0];
      if (n && n.textContent && n.textContent.trim()) return n.textContent.trim();
    }
    return '';
  }

  /**
   * GPX文字列を解析
   * @returns {{name:string, pts:Array, cum:Float64Array, totalKm:number, waypoints:Array}}
   */
  function parseGpx(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('GPXの解析に失敗しました（XMLとして読めません）');
    }
    var trkptNodes = doc.getElementsByTagName('trkpt');
    if (!trkptNodes.length) throw new Error('GPXにトラックポイント(trkpt)がありません');

    var pts = [];
    for (var i = 0; i < trkptNodes.length; i++) {
      var n = trkptNodes[i];
      var lat = parseFloat(n.getAttribute('lat'));
      var lon = parseFloat(n.getAttribute('lon'));
      if (!isFinite(lat) || !isFinite(lon)) continue;
      var eleNode = n.getElementsByTagName('ele')[0];
      pts.push({ lat: lat, lon: lon, ele: eleNode ? parseFloat(eleNode.textContent) : null });
    }
    if (pts.length < 2) throw new Error('トラックポイントが少なすぎます');

    var cum = new Float64Array(pts.length);
    for (var j = 1; j < pts.length; j++) {
      cum[j] = cum[j - 1] + U.haversine(pts[j - 1].lat, pts[j - 1].lon, pts[j].lat, pts[j].lon);
    }

    var wptNodes = doc.getElementsByTagName('wpt');
    var waypoints = [];
    for (var k = 0; k < wptNodes.length; k++) {
      var w = wptNodes[k];
      waypoints.push({
        lat: parseFloat(w.getAttribute('lat')),
        lon: parseFloat(w.getAttribute('lon')),
        // RideWithGPS書出しは <name>、簡略表記で <n> のこともある
        name: textOf(w, ['name', 'n']),
        cmt: textOf(w, ['cmt']),
        type: textOf(w, ['type', 'sym']),
        desc: textOf(w, ['desc'])
      });
    }

    var nameNode = doc.getElementsByTagName('name')[0];
    var trackName = nameNode ? nameNode.textContent.trim() : '';

    var track = {
      name: trackName,
      pts: pts,
      cum: cum,
      totalKm: cum[cum.length - 1] / 1000,
      waypoints: waypoints
    };
    // 各wptにコース上の位置（km）を割り当て
    waypoints.forEach(function (w) {
      if (!isFinite(w.lat) || !isFinite(w.lon)) { w.km = null; return; }
      var near = nearestOnTrack(track, w.lat, w.lon);
      w.km = near.km;
      w.offTrackM = near.distM;
    });
    return track;
  }

  /** 距離(m)配列に対する二分探索 → cum[i-1] <= d <= cum[i] となる i */
  function findIndex(cum, d) {
    var lo = 1, hi = cum.length - 1;
    if (d <= 0) return 1;
    if (d >= cum[hi]) return hi;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /**
   * 累積距離(km)から座標を線形補間で求める
   * @param {number} km GPX上の累積距離(km)
   */
  function locateAtKm(track, km) {
    var d = U.clamp(km * 1000, 0, track.cum[track.cum.length - 1]);
    var i = findIndex(track.cum, d);
    var d0 = track.cum[i - 1], d1 = track.cum[i];
    var t = (d1 - d0) > 0 ? (d - d0) / (d1 - d0) : 0;
    var a = track.pts[i - 1], b = track.pts[i];
    return {
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      ele: (a.ele != null && b.ele != null) ? a.ele + (b.ele - a.ele) * t : (a.ele != null ? a.ele : null),
      idx: i,
      km: d / 1000
    };
  }

  /** 指定距離地点の前後spanM区間から進行方位を算出（既定は「その先」の向き） */
  function bearingAtKm(track, km, spanM) {
    var span = spanM || 200;
    var total = track.cum[track.cum.length - 1];
    var d = U.clamp(km * 1000, 0, total);
    var aKm = U.clamp(d, 0, Math.max(0, total - 1)) / 1000;
    var bKm = U.clamp(d + span, 0, total) / 1000;
    if (bKm - aKm < 0.005) { // 終端付近：手前の向きを使う
      aKm = U.clamp(d - span, 0, total) / 1000;
      bKm = d / 1000;
    }
    var p = locateAtKm(track, aKm), q = locateAtKm(track, bKm);
    return U.bearing(p.lat, p.lon, q.lat, q.lon);
  }

  /** コース上の最近傍点（wptのkm割当・スナップ判定用） */
  function nearestOnTrack(track, lat, lon) {
    var best = Infinity, bi = 0;
    var pts = track.pts;
    // 粗探索 → 近傍を細探索（2万点でも十分速い）
    var step = Math.max(1, Math.floor(pts.length / 3000));
    for (var i = 0; i < pts.length; i += step) {
      var dLat = pts[i].lat - lat, dLon = (pts[i].lon - lon) * Math.cos(U.toRad(lat));
      var d2 = dLat * dLat + dLon * dLon;
      if (d2 < best) { best = d2; bi = i; }
    }
    var lo = Math.max(0, bi - step * 2), hi = Math.min(pts.length - 1, bi + step * 2);
    var bestM = Infinity, bj = bi;
    for (var j = lo; j <= hi; j++) {
      var m = U.haversine(lat, lon, pts[j].lat, pts[j].lon);
      if (m < bestM) { bestM = m; bj = j; }
    }
    return { idx: bj, km: track.cum[bj] / 1000, distM: bestM };
  }

  NS.gpx = {
    parseGpx: parseGpx,
    locateAtKm: locateAtKm,
    bearingAtKm: bearingAtKm,
    nearestOnTrack: nearestOnTrack,
    findIndex: findIndex
  };
})(BCG);
