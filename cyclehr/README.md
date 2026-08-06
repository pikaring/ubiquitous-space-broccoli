# CycleHR

サイクリング用Pebbleウォッチフェイス。直近60分の心拍数を1分ごとに記録し、
心拍ゾーン別に色分けした棒グラフで表示します。

設計の詳細は [DESIGN.md](DESIGN.md) を参照してください。

## 画面構成（上から）

1. **天気** — アイコン / 気温(°C) / 天候（Open-Meteo、APIキー不要、30分ごと更新）
2. **時刻** — 大きな時刻 + AM/PM + 曜日・日付
3. **現在心拍数** — 拍動するハートアイコン + bpm（15秒間隔でセンサーをサンプリング）
4. **1-MIN HR ZONES** — 直近60分の心拍を1分1本の棒グラフで表示。
   ゾーン色: Z1=グレー / Z2=青 / Z3=緑 / Z4=黄 / Z5=赤
5. **凡例** — Z1〜Z5

履歴はウォッチフェイスを閉じても保存され、再表示時に経過時間ぶんシフトして復元されます。

## 設定

Pebbleアプリのウォッチフェイス一覧から歯車アイコンをタップすると設定画面が開きます。

| 項目 | 内容 |
| --- | --- |
| 時刻フォーマット | 本体設定に従う / 12時間 (AM/PM) / 24時間 |
| 年齢 | 最大心拍数を `220 − 年齢` で算出。ゾーン境界は最大心拍数の 60 / 70 / 80 / 90% |

設定画面は GitHub Pages で配信しています
（[cyclehr.html](../cyclehr.html) → https://pikaring.github.io/ubiquitous-space-broccoli/cyclehr.html）。
Pages はデフォルトブランチから配信されるため、`cyclehr.html` を変更した場合は
デフォルトブランチにマージするまで実機へ反映されません。

設定は時計側にも保存されるので、スマホが繋がっていなくても前回の設定で動作します。

## 対応機種

- **diorite** (Pebble 2 HR, 144×168) — モノクロのため棒・凡例は白で表示
- **emery** (Pebble Time 2, 200×228) — フルカラー + 心拍

basalt (Pebble Time) は心拍センサー非搭載のため対象外です。

## ビルド

初回のみツールチェインを用意します。

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv tool install pebble-tool
pebble sdk install latest            # SDK 4.17

# エミュレータを使う場合のみ
sudo apt install -y libsdl2-2.0-0    # Debian / Ubuntu
brew install sdl2                    # macOS
```

ビルドと実行:

```sh
cd cyclehr
pebble build                         # -> build/cyclehr.pbw

pebble install --emulator emery      # エミュレータ
pebble install --phone <スマホのIP>   # 実機
pebble logs --phone <スマホのIP>      # ログ
```

Windows は WSL2 上の Ubuntu で同じ手順が使えます。

エミュレータでは心拍データが無いためグラフは空のままです。ゾーン色とチャートの
確認には実機 (diorite / emery) が必要です。天気はスマホの位置情報を使用します
（`capabilities: location`）。
