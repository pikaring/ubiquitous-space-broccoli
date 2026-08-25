# AvatarTalk

3D アバターに話しかけると、Claude が声で返事をする iOS アプリ。

文字だけのチャットではなく、画面の中の相手に向かって話す。マイクに向かって
しゃべると音声認識で文字になり、母艦（Mac や Raspberry Pi など）で動く小さな
ブリッジ経由で Claude に渡り、返ってきた返事を読み上げながらアバターが口を動かす。

```
iPhone                          母艦（同じ Wi-Fi）              Anthropic
┌─────────────────┐            ┌──────────────────┐          ┌──────────┐
│ 3D アバター     │  SSE       │ bridge (Node)    │          │  Claude  │
│ 音声認識 → 文字 │ ─────────▶ │ agent / api      │ ───────▶ │          │
│ 読み上げ + 口   │ ◀───────── │ 切り替え可能     │ ◀─────── │          │
└─────────────────┘  1文字ずつ  └──────────────────┘          └──────────┘
```

---

## 1. 料金の話（ここが一番大事）

やりたいことは「Pro プランの範囲で、話した分だけ課金されるのを避けたい」だと
思うので、そこから書く。

**Claude の課金は 2 系統あって、別会計になっている。**

| | 何 | 課金 |
|---|---|---|
| Claude Pro / Max | claude.ai と Claude Code のサブスク | 月額固定。使用量に応じたレート制限あり |
| Anthropic API | API キーで叩くやつ | トークン従量課金。Pro を払っていても**別で**かかる |

ふつうに「iOS アプリから Claude を呼ぶ」と書くと後者になる。つまり
**Pro を払っていても API 利用料は別で発生する**。これが避けたい状況のはず。

そこで、このプロジェクトのブリッジには 2 つのモードを用意してある。

### agent モード（既定・トークン課金なし）

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)（= Claude Code を
ライブラリとして使うもの）を経由する。認証は**母艦の Claude Code のログインを
そのまま使う**ので、Pro / Max のサブスクの枠内で動き、トークンの従量課金は
発生しない。

- 追加料金: なし（Pro の月額のみ）
- 制約: Pro のレート制限にはかかる。上限に達すると、しばらく返事が返らなくなる
- 必要なもの: 母艦に Claude Code が入っていてログイン済みであること

**規約についての注意（大事）。** Anthropic のドキュメントには次の但し書きがある。

> Unless previously approved, Anthropic does not allow third party developers to
> offer claude.ai login or rate limits for their products, including agents built
> on the Claude Agent SDK.

つまり「**自分のサブスクを、自分の端末から、自分で使う**」のは Claude Code の
ふつうの使い方の延長なので問題ないが、**このアプリを App Store 等で配布して
他人にサブスク枠を使わせるのは承認なしには認められていない**。人に配りたく
なったら次の api モードに切り替えて、使う人それぞれの API キーを入れてもらう
形にすること。

### api モード（配布したいとき・従量課金）

Anthropic API を直接叩く。`.env` の `BACKEND=api` と `ANTHROPIC_API_KEY` を設定
するだけで切り替わる。

雑談は 1 往復あたりの入出力が短いので、`claude-opus-5` でも 1 回数円程度。
ペルソナはプロンプトキャッシュに載せてあるので、往復を重ねても入力側は
そこまで増えない。安く回したいなら `.env` の `MODEL` を `claude-sonnet-5` や
`claude-haiku-4-5` にするとさらに下がる。

---

## 2. セットアップ

### 母艦（ブリッジ側）

Node 20 以上が必要。

```bash
cd avatartalk/bridge
npm install
cp .env.example .env
```

`.env` を開いて、最低限ここだけ埋める。

```ini
BACKEND=agent
BRIDGE_TOKEN=<長いランダム文字列。openssl rand -hex 24 などで作る>
```

agent モードなら、母艦で Claude Code にログイン済みならそのまま動く。
別マシンで動かす／ログイン状態に依存したくない場合は、

```bash
claude setup-token        # 長期トークンを発行する
```

で出たトークンを `.env` の `CLAUDE_CODE_OAUTH_TOKEN` に入れる。

起動する。

```bash
npm start
# [avatartalk] backend=agent model=claude-opus-5 listening on http://0.0.0.0:8787
```

ブラウザで `http://localhost:8787/` を開くと動作確認ページが出る。
`BRIDGE_TOKEN` を入れて送信し、返事が返ってくれば母艦側は完成。

母艦の LAN 内の IP アドレス（`ipconfig getifaddr en0` など）を控えておく。

### iPhone 側

```bash
open avatartalk/ios/AvatarTalk.xcodeproj
```

1. TARGETS → AvatarTalk → Signing & Capabilities で、自分の Apple ID の
   チームを選ぶ。Bundle Identifier は `com.example.avatartalk` のままだと
   他人と衝突するので、自分のものに変える
2. iPhone を繋いで実行（マイクと音声認識は実機でしか試せない）
3. アプリの右上の歯車から、ブリッジの URL（`http://192.168.x.x:8787`）と
   合言葉（`BRIDGE_TOKEN`）を入れて「接続を確かめる」

初回起動時にマイクと音声認識、ローカルネットワークの許可を聞かれるので許可する。

> Xcode のバージョン差でプロジェクトが開けないときは、`ios/project.yml` を
> 使って `xcodegen generate` で作り直せる。

---

## 3. 使い方

- 下の丸いボタンを押すと聞き取りが始まる。**1.4 秒黙ると自動で送信**される
- 考えている間はアバターが目線を外す。返事は**文が出来た端から読み上げる**ので、
  全部書き終わるのを待たずに話し始める
- 読み上げ中にボタンを押すと黙る
- 設定で「読み上げが終わったら自動で聞き始める」を入れると、ボタンを押さずに
  会話が続く（ハンズフリー）
- 声が気に入らないときは設定 → 声。iOS の設定アプリの
  「アクセシビリティ → 読み上げコンテンツ → 声」で高品質な日本語音声を
  ダウンロードしておくと、かなり良くなる

---

## 4. 中身を変える

### 性格・話し方

`bridge/persona.md` がそのままシステムプロンプトになる。名前も口調もここで決まる。
編集したらブリッジを再起動する。**「1〜3 文で答える」という指示は残しておくこと。**
読み上げるので、長い返事は聞いていられない。

### 見た目

アバターは球と箱だけでコードから組み立ててある（`AvatarController.swift`）。
素材ファイルが要らないので、クローンしてビルドすればすぐ動く。髪と服の色は
設定のスライダーで変わる。

自分で用意した 3D モデルを使いたい場合は、`Avatar.usdz` という名前で
`ios/AvatarTalk/` に入れる。あればそちらが優先して読み込まれる。VRM は
iOS がそのままでは読めないので、Blender などで glTF 経由 USDZ に変換しておく。

### リップシンク

音声合成の「いまここを読んでいる」通知を手がかりに、その区間のかなを母音
（あいうえお）に落として口の形を作っている。日本語は母音が 5 つしかないので、
これだけでかなりそれらしく見える。詳しくは `Viseme.swift`。

---

## 5. 分かっている弱点

- **母艦が動いていないと会話できない。** agent モードは Claude Code のログインを
  使う都合上、どこかに常時動いているプロセスが要る。外から使いたいなら
  Tailscale などで母艦に VPN で入るのが手軽（ブリッジをそのまま
  インターネットに晒すのはやめたほうがいい）
- **リップシンクは音声そのものではなく文字から作っている。** 実際の音と数十
  ミリ秒ずれることがある
- 通信は LAN 内の http。`BRIDGE_TOKEN` による合言葉認証だけで、TLS は張って
  いない。自宅の Wi-Fi 前提の作り
- Pro のレート制限に当たると、しばらく返事が返らない（アプリにはその旨が出る）

---

## 6. ディレクトリ

```
avatartalk/
├── bridge/                 母艦で動かす Node のブリッジ
│   ├── persona.md          アバターの性格（システムプロンプト）
│   └── src/
│       ├── server.mjs      SSE の受け口
│       ├── backend-agent.mjs   Claude Agent SDK（サブスク認証）
│       └── backend-api.mjs     Anthropic API（従量課金）
└── ios/
    ├── AvatarTalk.xcodeproj
    ├── Support/Info.plist
    └── AvatarTalk/
        ├── AvatarController.swift  3D アバターの組み立てと毎フレームの動き
        ├── Speaker.swift           読み上げ + 口の形
        ├── SpeechRecognizer.swift  音声認識
        ├── BridgeClient.swift      ブリッジとの SSE
        └── ConversationViewModel.swift  会話の進行
```
