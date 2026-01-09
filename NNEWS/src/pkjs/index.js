// --- 設定: ここにアップロードしたconfig.htmlのURLを入れてください ---
// 例: 'https://yourname.github.io/pebble-news/config.html'
var CONFIG_URL = 'https://pikaring.github.io/ubiquitous-space-broccoli/'; 

// ニュースソースのURL
var URL_JA = 'https://script.google.com/macros/s/AKfycby1uK606WpIBfn6oxRaALBsUDgL4RO0Z6KYap5H_kaf9P8MCHX8ywfadbW8A53QiLjt4Q/exec?id=1iakCqQKqMqYKxBcIImwZm7l-W1-2sZBq9vDLMa0vvyg&name=NEWS';
var URL_EN = 'https://script.google.com/macros/s/AKfycby1uK606WpIBfn6oxRaALBsUDgL4RO0Z6KYap5H_kaf9P8MCHX8ywfadbW8A53QiLjt4Q/exec?id=1J6BaIXYNlptRgG84FVHZ69t2tA9WjgJbf5pAsBvvZ2w&name=NEWS';

var xhrRequest = function (url, type, callback) {
  var xhr = new XMLHttpRequest();
  xhr.onload = function () {
    callback(this.responseText);
  };
  xhr.onerror = function () {
    console.log("XHR error");
  };
  xhr.open(type, url);
  xhr.send();
};

function fetchNews() {
  // 保存されている設定を読み込む (デフォルトは 'ja')
  var currentLang = localStorage.getItem('language') || 'en';
  
  // 言語に応じてURLを切り替える
  var url = (currentLang === 'en') ? URL_EN : URL_JA;
  
  console.log('Fetching news for lang: ' + currentLang);

  xhrRequest(url, 'GET', function(responseText) {
    try {
      var json = JSON.parse(responseText);
      var keys = require('message_keys');

      // 配列の0番目を取得
      var dict = {};
      dict[keys.KEY_TITLE] = json[0].TITLE;
      dict[keys.KEY_NEWS]  = json[0].NEWS;

      Pebble.sendAppMessage(dict,
        function(e) {
          console.log('News sent OK');
        },
        function(e) {
          console.log('Send failed');
        }
      );
    } catch (e) {
      console.log('JSON parse error: ' + e);
    }
  });
}

Pebble.addEventListener('ready', function() {
  console.log('PebbleKit JS ready');
  fetchNews();
});

Pebble.addEventListener('appmessage', function(e) {
  fetchNews();
});

// --- 設定画面関連の処理 ---

// 1. 設定ボタンが押されたら設定ページを開く
Pebble.addEventListener('showConfiguration', function(e) {
  Pebble.openURL(CONFIG_URL);
});

// 2. 設定画面が閉じられたら、結果を受け取って保存し、ニュースを再取得する
Pebble.addEventListener('webviewclosed', function(e) {
  if (e.response) {
    var configData = JSON.parse(decodeURIComponent(e.response));
    console.log('Configuration received: ' + JSON.stringify(configData));

    // 設定を保存
    localStorage.setItem('language', configData.language);

    // すぐに新しい言語でニュースを取得
    fetchNews();
  }
});