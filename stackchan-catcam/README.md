# Stack-chan 猫見守りカメラ

Stack-chan（M5Stack CoreS3）で猫を見守り、写真をクラウドに上げ、毎日4枚を母親にLINEで送る。

```
Stack-chan --HTTPS POST--> Cloudflare Worker --> R2 (写真保存)
  ・1時間ごと                    |
  ・動体検知                     +-- 毎日20:00 JST: 当日の4枚を選んでLINE Flexメッセージ1通で送信
```

- 動体検知はカメラ映像（VGA）を80x60セルに間引き、移動平均の背景との差分で判定する。
  60秒のクールダウンと1日150枚の上限あり。
- 4枚の選び方: その日の写真を時系列で4等分し、各区間から動体検知の写真を優先して1枚ずつ。
- LINEはメッセージ1通（2x2のFlex）にまとめている。メッセージ数の無料枠に収めるため。

## 1. Worker (クラウド側)

```sh
cd worker
npx wrangler r2 bucket create stackchan-catcam
npx wrangler secret put UPLOAD_TOKEN              # 適当な長いランダム文字列
npx wrangler secret put SIGNING_SECRET            # 同上（画像URLの署名用）
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN # 下記のLINE設定で取得
npx wrangler deploy
```

デプロイ後に出る URL を `wrangler.toml` の `PUBLIC_BASE_URL` に書いて、もう一度 `wrangler deploy`。

R2 のライフサイクルルールで `photos/` を30日で削除しておく（Cloudflare ダッシュボード → R2 → バケット → 設定）。
画像URLの有効期限も30日。

## 2. LINE

LINE Notify は終了しているので Messaging API を使う。

1. LINE Developers で Messaging API チャネルを作り、チャネルアクセストークン（長期）を発行する。
2. 母親と自分で、そのLINE公式アカウントを友だち追加する。
3. 既定は友だち全員への broadcast。特定の人だけに送りたい場合は `LINE_TO` に userId を入れると push になる。

動作確認（夜を待たずに送る）:

```sh
curl -X POST -H "Authorization: Bearer $UPLOAD_TOKEN" https://<worker-url>/digest
```

## 3. ファームウェア

```sh
cd firmware
cp src/secrets.h.example src/secrets.h   # Wi-Fi、トークン、UPLOAD_URL を記入
pio run -t upload
pio device monitor
```

起動時に1枚撮ってアップロードする（疎通確認）。画面は15秒で消え、タッチで再点灯する。

## 調整

`firmware/src/main.cpp` 冒頭のパラメータで調整する。

- 猫が動いても反応しない → `CELL_DIFF_THRESHOLD` か `MOTION_RATIO` を下げる
- 日差しや影で撮りすぎる → 上げる、または `MOTION_COOLDOWN_MS` を延ばす
- 輝度は RGB565 の2バイト平均で近似している。精度が必要なら緑成分の抽出に変える

## 既知の注意

- TLS は `setInsecure()`（証明書検証なし）。気になる場合は Cloudflare のルート証明書を `setCACert` で固定する。
- 実機での動作確認は未実施。
