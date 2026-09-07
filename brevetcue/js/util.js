/* ブルベ キューシート生成 - 共通ユーティリティ
   （file:// でも動くようクラシックスクリプト＋グローバル名前空間 BCG） */
var BCG = window.BCG || {};
(function (NS) {
  'use strict';

  var R = 6371008.8; // 地球平均半径(m)

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  /** 2点間の距離(m) */
  function haversine(lat1, lon1, lat2, lon2) {
    var p1 = toRad(lat1), p2 = toRad(lat2);
    var dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** 方位角(0-360, 北=0) */
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /** 方位差（-180〜180、右回りが正） */
  function angleDiff(from, to) {
    var d = ((to - from + 540) % 360) - 180;
    return d;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** 出走からの経過分 → 表示用時刻（翌/3日目 プレフィックス付き） */
  function fmtClock(minFromStart, startMinOfDay) {
    var abs = (startMinOfDay || 0) + Math.round(minFromStart);
    var day = Math.floor(abs / 1440);
    var r = ((abs % 1440) + 1440) % 1440;
    var prefix = day === 0 ? '' : (day === 1 ? '翌' : (day + 1) + '日目 ');
    return prefix + pad2(Math.floor(r / 60)) + ':' + pad2(r % 60);
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 全角英数字・記号を半角へ（列名やキーワード判定の正規化用） */
  function normalizeText(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .replace(/[　\s]+/g, ' ')
      .trim();
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 日出・日没（NOAA簡易式）。date=Date(JST基準の年月日), 返り値は分(現地=JST) */
  function sunTimes(lat, lon, date, tzOffsetMin) {
    var tz = (tzOffsetMin === undefined) ? 540 : tzOffsetMin;
    var start = new Date(Date.UTC(date.getFullYear(), 0, 0));
    var diff = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start;
    var n = Math.floor(diff / 86400000);
    function calc(isSunrise) {
      var lngHour = lon / 15;
      var t = n + ((isSunrise ? 6 : 18) - lngHour) / 24;
      var M = (0.9856 * t) - 3.289;
      var L = M + (1.916 * Math.sin(toRad(M))) + (0.020 * Math.sin(toRad(2 * M))) + 282.634;
      L = (L + 360) % 360;
      var RA = toDeg(Math.atan(0.91764 * Math.tan(toRad(L))));
      RA = (RA + 360) % 360;
      RA = RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);
      RA = RA / 15;
      var sinDec = 0.39782 * Math.sin(toRad(L));
      var cosDec = Math.cos(Math.asin(sinDec));
      var zenith = 90.833;
      var cosH = (Math.cos(toRad(zenith)) - (sinDec * Math.sin(toRad(lat)))) / (cosDec * Math.cos(toRad(lat)));
      if (cosH > 1 || cosH < -1) return null; // 白夜・極夜
      var H = isSunrise ? (360 - toDeg(Math.acos(cosH))) : toDeg(Math.acos(cosH));
      H = H / 15;
      var T = H + RA - (0.06571 * t) - 6.622;
      var UT = ((T - lngHour) % 24 + 24) % 24;
      return Math.round(UT * 60 + tz) % 1440;
    }
    return { sunrise: calc(true), sunset: calc(false) };
  }

  NS.util = {
    haversine: haversine, bearing: bearing, angleDiff: angleDiff,
    pad2: pad2, fmtClock: fmtClock, escapeHtml: escapeHtml,
    normalizeText: normalizeText, clamp: clamp, sunTimes: sunTimes,
    toRad: toRad, toDeg: toDeg
  };
})(BCG);
window.BCG = BCG;
