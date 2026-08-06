// CycleHR - weather fetcher (Open-Meteo, no API key required)

var ICON_SUN = 0;
var ICON_PART_CLOUD = 1;
var ICON_CLOUD = 2;
var ICON_RAIN = 3;
var ICON_SNOW = 4;
var ICON_THUNDER = 5;

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
  Pebble.sendAppMessage({
    TEMPERATURE: Math.round(temp),
    CONDITIONS: d.text,
    ICON: d.icon
  }, function() {
    console.log('Weather sent: ' + temp + 'C ' + d.text);
  }, function(e) {
    console.log('Weather send failed');
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

// --- settings (config screen hosted on GitHub Pages) -----------------------

var CONFIG_URL = 'https://pikaring.github.io/ubiquitous-space-broccoli/cyclehr.html';

function getConfig() {
  var raw = localStorage.getItem('config');
  return raw ? JSON.parse(raw) : { time_format: 0, age: 35 };
}

function sendConfig(cfg) {
  var age = parseInt(cfg.age, 10);
  if (isNaN(age) || age < 5 || age > 120) age = 35;
  Pebble.sendAppMessage({
    TIME_FORMAT: parseInt(cfg.time_format, 10) || 0,
    MAX_HR: 220 - age
  }, function() {
    console.log('Config sent: tf=' + cfg.time_format + ' age=' + age);
  }, function() {
    console.log('Config send failed');
  });
}

Pebble.addEventListener('showConfiguration', function() {
  var cfg = getConfig();
  var url = CONFIG_URL +
    '?time_format=' + encodeURIComponent(cfg.time_format) +
    '&age=' + encodeURIComponent(cfg.age);
  Pebble.openURL(url);
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response) return;
  var cfg;
  try {
    cfg = JSON.parse(decodeURIComponent(e.response));
  } catch (err) {
    console.log('Config parse error: ' + err);
    return;
  }
  localStorage.setItem('config', JSON.stringify(cfg));
  sendConfig(cfg);
});

Pebble.addEventListener('ready', function() {
  // push stored settings to the watch on launch
  sendConfig(getConfig());
  fetchWeather();
  // refresh every 30 minutes while the watchface is open
  setInterval(fetchWeather, 30 * 60 * 1000);
});
