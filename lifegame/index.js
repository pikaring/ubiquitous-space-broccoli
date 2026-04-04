function getCondition(code) {
  if (code === 0) return "SUNNY";
  if (code >= 1 && code <= 3) return "CLOUDY";
  if (code >= 45 && code <= 48) return "FOGGY";
  if (code >= 51 && code <= 67) return "RAINY";
  if (code >= 71 && code <= 77) return "SNOWY";
  if (code >= 80 && code <= 82) return "SHOWER";
  if (code >= 95) return "STORM";
  return "CLEAR";
}

function fetchWeather() {
  navigator.geolocation.getCurrentPosition(function(pos) {
    // 緯度経度を取得
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    
    // Open-Meteo URL (修正ポイント: httpsを確実に使用)
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
              '&longitude=' + lon +
              '&current=temperature_2m,weather_code&timezone=auto';

    console.log("Fetching: " + url);

    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
      // レスポンスが空でないか、ステータスが200(OK)か確認
      if (this.status === 200 && this.responseText) {
        console.log("Response received: " + this.responseText);
        try {
          var json = JSON.parse(this.responseText);
          
          if (json && json.current) {
            var cond = getCondition(json.current.weather_code);
            var temp = Math.round(json.current.temperature_2m);
            var weatherString = cond + " " + temp + "C";
            
            console.log("Weather to send: " + weatherString);
            Pebble.sendAppMessage({ 0: weatherString });
          }
        } catch (e) {
          console.log("JSON parse error: " + e);
          Pebble.sendAppMessage({ 0: "PARSE ERR" });
        }
      } else {
        console.log("HTTP Error: " + this.status);
        Pebble.sendAppMessage({ 0: "HTTP ERR" });
      }
    };
    
    xhr.onerror = function () {
      console.log("XHR request failed");
      Pebble.sendAppMessage({ 0: "CONN ERR" });
    };

    xhr.open('GET', url);
    xhr.timeout = 10000; // 10秒でタイムアウト設定
    xhr.send();

  }, function(err) {
    console.log("Location error: " + err.message);
    // 位置情報が取れない場合はデフォルト値やエラーを表示
    Pebble.sendAppMessage({ 0: "LOC ERR" });
  }, {timeout: 15000, maximumAge: 60000});
}

Pebble.addEventListener('ready', function() {
  console.log("PebbleKit JS ready");
  fetchWeather();
});

Pebble.addEventListener('appmessage', function() {
  fetchWeather();
});
