/* 曲がり角の自動抽出（Excelに進路情報が無い場合のフォールバック / Phase4）
   方位変化点を検出し、直進・右左折・Uターンに分類する */
(function (NS) {
  'use strict';
  var U = NS.util, G = NS.gpx;

  var DEFAULTS = {
    minAngle: 50,     // これ以上の方位変化を曲がり角とみなす(度)
    armM: 40,         // 前後の腕の長さ(m)
    wideArmM: 130,    // 誤検出（S字・カーブ）除去に使う長い腕(m)
    mergeM: 60,       // これ以内の候補は1つにまとめる(m)
    sampleM: 10       // 走査間隔(m)
  };

  function classify(delta) {
    var a = Math.abs(delta);
    if (a >= 150) return 'uturn';
    if (a >= 110) return delta > 0 ? 'sharp-right' : 'sharp-left';
    if (a >= 45) return delta > 0 ? 'right' : 'left';
    return delta > 0 ? 'slight-right' : 'slight-left';
  }

  /**
   * @param {object} track parseGpxの戻り値
   * @param {object} opt   DEFAULTS参照
   * @returns {Array<{km,lat,lon,delta,direction,bearingIn,bearingOut}>}
   */
  function detectTurns(track, opt) {
    var o = Object.assign({}, DEFAULTS, opt || {});
    var totalM = track.cum[track.cum.length - 1];
    var cands = [];

    for (var d = o.armM; d <= totalM - o.armM; d += o.sampleM) {
      var pIn = G.locateAtKm(track, (d - o.armM) / 1000);
      var pAt = G.locateAtKm(track, d / 1000);
      var pOut = G.locateAtKm(track, (d + o.armM) / 1000);
      var bIn = U.bearing(pIn.lat, pIn.lon, pAt.lat, pAt.lon);
      var bOut = U.bearing(pAt.lat, pAt.lon, pOut.lat, pOut.lon);
      var delta = U.angleDiff(bIn, bOut);
      if (Math.abs(delta) < o.minAngle) continue;

      // 長い腕でも同方向に曲がっているか（緩いカーブ・S字の誤検出を抑える）
      var wIn = G.locateAtKm(track, Math.max(0, d - o.wideArmM) / 1000);
      var wOut = G.locateAtKm(track, Math.min(totalM, d + o.wideArmM) / 1000);
      var wDelta = U.angleDiff(
        U.bearing(wIn.lat, wIn.lon, pAt.lat, pAt.lon),
        U.bearing(pAt.lat, pAt.lon, wOut.lat, wOut.lon)
      );
      if (wDelta * delta <= 0 || Math.abs(wDelta) < o.minAngle * 0.5) continue;

      cands.push({ m: d, lat: pAt.lat, lon: pAt.lon, delta: delta, bearingIn: bIn, bearingOut: bOut });
    }

    // 近接候補のマージ（|delta|最大のものを代表にする）
    var out = [];
    var group = [];
    function flush() {
      if (!group.length) return;
      var best = group[0];
      for (var i = 1; i < group.length; i++) {
        if (Math.abs(group[i].delta) > Math.abs(best.delta)) best = group[i];
      }
      out.push({
        km: best.m / 1000,
        lat: best.lat, lon: best.lon,
        delta: Math.round(best.delta * 10) / 10,
        direction: classify(best.delta),
        bearingIn: best.bearingIn,
        bearingOut: best.bearingOut
      });
      group = [];
    }
    for (var c = 0; c < cands.length; c++) {
      if (group.length && cands[c].m - group[group.length - 1].m > o.mergeM) flush();
      group.push(cands[c]);
    }
    flush();
    return out;
  }

  NS.turns = { detectTurns: detectTurns, DEFAULTS: DEFAULTS, classify: classify };
})(BCG);
