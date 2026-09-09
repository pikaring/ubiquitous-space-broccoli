# ubiquitous-space-broccoli — 開発ノート

## リポジトリ構成

モノレポ。各ウォッチフェイスはリポジトリ直下のサブフォルダに格納。

```
cyclehr/        ← Pebble ウォッチフェイス（心拍ゾーン表示）
wordsquare/
NNEWS/
...
cyclehr.html    ← GitHub Pages 設定画面（リポジトリ直下）
wordsquare.html
```

- **開発ブランチ**: 機能ごとに `claude/<name>` ブランチを切って開発
- **デフォルトブランチ**: `codespace-ubiquitous-space-broccoli-5g4qwwv67qq2vjqr`（`master` は存在しない）
- GitHub Pages はデフォルトブランチのルートから公開

---

## Pebble SDK ビルド環境

- ビルドツール: `/root/.local/bin/pebble`（pebble-tool v5.0.x）
- コンパイラ: `arm-none-eabi-gcc`
- ビルドコマンド: プロジェクトの `package.json` があるフォルダで `pebble build`
- 成果物: `build/cyclehr.pbw`（またはプロジェクト名.pbw）

### wscript に必要な GCC 9+ 互換フラグ

SDK 4.4 は GCC 4.x 向けに書かれているため、ローカルの GCC 9+ では警告がエラーになる。
`wscript` の `build()` 内で以下を追加しないとビルドが通らない:

```python
ctx.env.append_value('CFLAGS', ['-Wno-builtin-macro-redefined',
                                '-Wno-builtin-declaration-mismatch'])
```

### time_t の互換性問題

ローカル toolchain は `-D_TIME_H_` で `<time.h>` を抑制するため `time_t` が未定義になる。
CloudPebble は代わりに `-Dtime_t=long` を渡す（マクロ定義済み）。
`#include <sys/types.h>` を無条件に書くと CloudPebble で `two or more data types` エラーになる。

**正しい書き方**:
```c
#ifndef time_t
#include <sys/types.h>
#endif
#include <pebble.h>
```

---

## CloudPebble 連携

CloudPebble（https://cloudpebble.repebble.com）は **リポジトリ直下に 1 プロジェクト** を期待する。
モノレポとの連携には専用ブランチを用意する。

### 専用ブランチの作り方（各ウォッチフェイスで同じ手順）

1. 開発ブランチから新しい専用ブランチを作成
2. `git mv <watchface>/package.json package.json` などでプロジェクトファイルをルートに移動
3. 他のウォッチフェイスフォルダは `git rm -r` で削除（このブランチだけ）
4. ビルドを確認してプッシュ

```bash
git checkout -b <watchface>-cloudpebble
git mv cyclehr/package.json package.json
git mv cyclehr/wscript wscript
git mv cyclehr/src src
git mv cyclehr/resources resources
git rm -r NNEWS wordsquare ...
pebble build   # ビルド確認
git push origin <watchface>-cloudpebble
```

**現在の専用ブランチ**: `cyclehr-cloudpebble`

### CloudPebble の GITHUB 設定

| 項目 | 設定値 |
|---|---|
| GITHUB REPO | `github.com/pikaring/ubiquitous-space-broccoli` |
| BRANCH | `cyclehr-cloudpebble`（または各専用ブランチ名） |
| PULL CHANGES | Automatically |
| AFTER PULLING | Build automatically |

### 開発フロー

```
開発ブランチ (claude/xxx) で開発・ビルド・.pbw 送付
       ↓  完成したら
<watchface>-cloudpebble ブランチへ同じ修正を反映
       ↓
CloudPebble で PULL LATEST COMMIT → Rebble ストアに公開
```

専用ブランチへの反映: 同一ファイルを `git checkout <専用ブランチ>` 後に編集してコミットするか、`git cherry-pick` を使う。

---

## Pebble 設定画面（GitHub Pages）

設定画面は **リポジトリ直下の `<watchface>.html`** として配置（例: `cyclehr.html`）。
他の設定ページ（`wordsquare.html` など）と同じ階層。

- URL: `https://pikaring.github.io/ubiquitous-space-broccoli/<watchface>.html`
- `package.json` の `capabilities` に `"configurable"` が必要（これがないと歯車アイコンが出ない）
- `pkjs/index.js` で `showConfiguration` / `webviewclosed` を実装
- 設定値は `localStorage` に保存し、`ready` イベントでウォッチに push
- `webviewclosed` のレスポンスは `pebblejs://close#` + `encodeURIComponent(JSON.stringify(cfg))`

**`capabilities` に必要な全項目（cyclehr の例）**:
```json
"capabilities": ["location", "health", "configurable"]
```

---

## カスタムフォントの組み込み

### Pebble フォントの仕組み

- フォントサイズ = セル高さ（px）。可視の文字高さは通常の約 70%
- 例: Orbitron 36pt → 文字の実際の見た目は約 25px 相当
- 必要な見た目の高さ × 1.43 が目安のフォントサイズ

### 変数フォント（Variable Font）の静的化

Google Fonts の Orbitron は `Orbitron[wght].ttf`（可変フォント）として配布。
Pebble SDK は静的 TTF のみ対応するため、fonttools で特定ウェイトを切り出す:

```bash
pip3 install fonttools
python3 -c "
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont
font = TTFont('Orbitron[wght].ttf')
result = instantiateVariableFont(font, {'wght': 700})
result.save('OrbitronBold.ttf')
"
```

### `package.json` への登録

```json
{
  "type": "font",
  "name": "FONT_ORBITRON_36",
  "file": "fonts/OrbitronBold.ttf",
  "characterRegex": "[0-9\\-:]"
}
```

`name` のサフィックス（`_36`）が Pebble のセル高さになる。
ラベル用フォントは `"characterRegex": "[ -~°]"` で ASCII + 度数記号をカバー。

---

## 対応プラットフォーム

| Platform | 解像度 | カラー | 心拍センサー |
|---|---|---|---|
| emery (Pebble Time 2) | 200×228 | ○ | ○ |
| diorite (Pebble 2 HR) | 144×168 | ✕（モノクロ） | ○ |
| basalt (Pebble Time) | 144×168 | ○ | ✕ |

basalt は `targetPlatforms` に含めない（HR センサーなし）。
`PBL_HEALTH` マクロでヘルス機能の有無を条件分岐。
`PBL_COLOR` マクロでカラー／モノクロを条件分岐。
