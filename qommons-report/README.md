# Qommons AI 利用状況レポート(毎朝8時 JST 自動実行)

毎朝 8:00(日本時間)に Claude の定期タスク(Routine)が起動し、以下を行います。

1. Qommons AI にメール+パスワードでログイン(Playwright によるブラウザ自動操作)
2. 画面左下のメニューから「ログ」を開き、当月1日〜当日の利用ログ CSV をダウンロード
3. CSV を集計して利用状況レポート(Markdown)を `qommons-report/reports/YYYY-MM-DD.md` に生成
4. このリポジトリの `claude/daily-8am-task-p6u7l4` ブランチにコミット・プッシュ

## 事前準備(環境設定)

Claude Code on the web の環境設定(claude.ai/code → 対象 Environment)で以下が必要です。

### 1. ネットワーク許可

ネットワークポリシーで `qommons.ai`(およびログイン・API に使うサブドメイン)を許可するか、
フルインターネットアクセスにする。

### 2. 環境変数(シークレット)

| 変数名 | 内容 |
|---|---|
| `QOMMONS_EMAIL` | ログイン用メールアドレス |
| `QOMMONS_PASSWORD` | ログイン用パスワード |
| `QOMMONS_URL` | (任意)ログインページ URL。既定は `https://qommons.ai/` |

認証情報はリポジトリ・レポート・ログには一切書き込みません。

## 手動実行

```sh
cd qommons-report
npm init -y && npm i playwright   # 初回のみ(ブラウザ本体はプリインストール済み)
node fetch_logs.mjs
```

成功すると `downloads/qommons-log-YYYY-MM-DD.csv` が保存されます。
失敗時は `debug/` にスクリーンショットとページ HTML が残るので、それを見て
`fetch_logs.mjs` のセレクタを実際の画面に合わせて修正してください。

## メモ

- `fetch_logs.mjs` のセレクタは初回実行前の推測ベース。実際の Qommons AI の
  画面構成に合わせて初回実行時に調整される想定。
- レポートの集計内容(列名など)は CSV の実際のスキーマを見て決める。
- `downloads/` と `debug/` は Git 管理外(.gitignore 済み)。
