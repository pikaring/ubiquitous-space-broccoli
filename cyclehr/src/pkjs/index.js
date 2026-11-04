// CycleHR - weather fetcher (Open-Meteo, no API key required) + brevet progress

var Brevet = require('./brevet');

// ブルベ設定ページ(GitHub Pages)
var CONFIG_URL = 'https://pikaring.github.io/ubiquitous-space-broccoli/cyclehr/config.html';
// 位置を取って時計に送る間隔
var BREVET_POLL_MS = 2 * 60 * 1000;

var ICON_SUN = 0;
var ICON_PART_CLOUD = 1;
var ICON_CLOUD = 2;
var ICON_RAIN = 3;
var ICON_SNOW = 4;
var ICON_THUNDER = 5;

// ---- 送信キュー ----------------------------------------------------------------
// AppMessageは送信中に次を送ると失敗するので、1件ずつ順に送る。
// ブルベの更新は古いものを捨て、最新だけを送る。

var queue = [];
var sending = false;

function pump() {
  if (sending || queue.length === 0) { return; }
  sending = true;
  var item = queue.shift();
  Pebble.sendAppMessage(item.dict, function () {
    sending = false;
    pump();
  }, function () {
    console.log(item.label + ' send failed');
    sending = false;
    pump();
  });
}

function enqueue(label, dict) {
  if (label === 'brevet') {
    queue = queue.filter(function (q) { return q.label !== 'brevet'; });
  }
  queue.push({ label: label, dict: dict });
  pump();
}

// ---- 天気 ---------------------------------------------------------------------

// Map WMO weather codes to a condition label + icon
function describe(code) {
  if (code === 0) return { text: 'SUNNY', icon: ICON_SUN };
  if (code === 1 || code === 2) return { text: 'P.CLOUDY', icon: ICON_PART_CLOUD };
  if (code === 3) return { text: 'CLOUDY', icon: ICON_CLOUD };
  if (code === 45 || code === 48) return { text: 'FOG', icon: ICON_CLOUD };
  if (code >= 51 && code <= 67) return { text: 'RAIN', icon: ICON_RAIN };
  if (code >= 71 && code <= 77) return { text: 'SNOW', icon: ICON_SNOW };
  if (code >= 80 && code <= 82) return { text: 'SHOWERS', icon: ICON_RAIN };
  if (code === 85 || code === 86) return { text: 'SNOW', icon: ICON_SNOW };
  if (code >= 95) return { text: 'THUNDER', icon: ICON_THUNDER };
  return { text: '---', icon: ICON_CLOUD };
}

function sendWeather(temp, code) {
  var d = describe(code);
  enqueue('weather', {
    TEMPERATURE: Math.round(temp),
    CONDITIONS: d.text,
    ICON: d.icon
  });
}

function fetchWeather() {
  navigator.geolocation.getCurrentPosition(function(pos) {
    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + pos.coords.latitude +
      '&longitude=' + pos.coords.longitude +
      '&current_weather=true';
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
      try {
        var json = JSON.parse(this.responseText);
        var cw = json.current_weather;
        sendWeather(cw.temperature, cw.weathercode);
      } catch (err) {
        console.log('Weather parse error: ' + err);
      }
    };
    xhr.onerror = function() {
      console.log('Weather request failed');
    };
    xhr.open('GET', url);
    xhr.send();
  }, function(err) {
    console.log('Geolocation error: ' + err.message);
  }, { timeout: 15000, maximumAge: 30 * 60 * 1000 });
}

// ---- ブルベ -------------------------------------------------------------------

var prep = null;  // 展開済みの計画

function loadJson(key) {
  try {
    var s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.log('save failed: ' + key);
  }
}

function getPrep() {
  if (!prep) {
    var plan = loadJson('brevetPlan');
    if (plan && plan.v === 1) { prep = Brevet.prepare(plan); }
  }
  return prep;
}

function resetBrevetState() {
  prep = null;
  localStorage.removeItem('brevetKm');
  localStorage.removeItem('brevetKmTime');
  localStorage.removeItem('brevetDone');
  localStorage.removeItem('brevetLast');
}

function toDict(r, fixTime) {
  if (r.state === 2) {
    return { BREVET_STATE: 2, DEADLINE: r.deadline, FIX_TIME: fixTime };
  }
  if (r.state === 3) {
    return { BREVET_STATE: 3, SAVING_MIN: r.saving, FIX_TIME: fixTime };
  }
  return {
    BREVET_STATE: 1,
    DEADLINE: r.deadline,
    NEXT_NAME: r.nextName,
    NEXT_DIST: r.nextDistDm,
    GOAL_DIST: r.goalDistDm,
    FIX_TIME: fixTime
  };
}

function sendBrevet(dict) {
  saveJson('brevetLast', dict);
  enqueue('brevet', dict);
}

function pollBrevet() {
  var p = getPrep();
  if (!p) {
    enqueue('brevet', { BREVET_STATE: 0 });
    return;
  }
  var now = Math.floor(Date.now() / 1000);

  var done = loadJson('brevetDone');
  if (done) {
    sendBrevet({ BREVET_STATE: 3, SAVING_MIN: done.saving, FIX_TIME: done.time });
    return;
  }
  if (now < p.plan.start) {
    sendBrevet(toDict(Brevet.evaluate(p, now, null, null), now));
    return;
  }

  navigator.geolocation.getCurrentPosition(function (pos) {
    var t = Math.floor(Date.now() / 1000);
    var stored = localStorage.getItem('brevetKm');
    var prevKm = stored === null ? null : parseFloat(stored);
    var prevTime = parseInt(localStorage.getItem('brevetKmTime'), 10) || 0;
    var r = Brevet.evaluate(p, t, { lat: pos.coords.latitude, lon: pos.coords.longitude },
                            prevKm, prevTime);
    if (!r) {
      // コースから離れている。表示は前回のままにして、時計側で「?」を付ける
      console.log('Brevet: off route');
      return;
    }
    localStorage.setItem('brevetKm', String(r.km));
    localStorage.setItem('brevetKmTime', String(t));
    if (r.state === 3) { saveJson('brevetDone', { saving: r.saving, time: t }); }
    sendBrevet(toDict(r, t));
  }, function (err) {
    console.log('Brevet geolocation error: ' + err.message);
  }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60 * 1000 });
}

Pebble.addEventListener('ready', function() {
  fetchWeather();
  // refresh every 30 minutes while the watchface is open
  setInterval(fetchWeather, 30 * 60 * 1000);

  // 前回の結果を先に送り、位置が取れたら更新する
  var last = loadJson('brevetLast');
  if (last && getPrep()) { enqueue('brevet', last); }
  pollBrevet();
  setInterval(pollBrevet, BREVET_POLL_MS);
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(CONFIG_URL);
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) { return; }
  var cfg;
  try {
    var raw = e.response;
    if (raw.charAt(0) !== '{') { raw = decodeURIComponent(raw); }
    cfg = JSON.parse(raw);
  } catch (err) {
    console.log('Config parse error: ' + err);
    return;
  }
  if (cfg.clear) {
    resetBrevetState();
    localStorage.removeItem('brevetPlan');
  } else if (cfg.plan && cfg.plan.v === 1) {
    resetBrevetState();
    saveJson('brevetPlan', cfg.plan);
  } else {
    return;
  }
  pollBrevet();
});
