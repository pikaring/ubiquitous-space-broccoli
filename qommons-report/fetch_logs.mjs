// Qommons AI 利用ログ CSV 自動ダウンロードスクリプト
//
// 使い方:
//   node qommons-report/fetch_logs.mjs
//
// 必要な環境変数:
//   QOMMONS_EMAIL    ログイン用メールアドレス
//   QOMMONS_PASSWORD ログイン用パスワード
//   QOMMONS_URL      (任意) ログインページ URL。既定: https://qommons.ai/login
//
// 出力:
//   qommons-report/downloads/qommons-log-YYYY-MM-DD.csv(当月1日〜当日 JST)
//   失敗時は qommons-report/debug/ にスクリーンショットと HTML を保存して exit 1。
//
// 実機で確認済みのフロー (2026-07-20):
//   1. /login で input[name=username] / input[name=password] → 「ログイン」ボタン
//   2. /log-dashboard(利用者ログ)は Amazon QuickSight ダッシュボードの iframe 埋め込み。
//      iframe 内からのダウンロードはヘッドレスで拾えないため、iframe の埋め込み URL を
//      リクエスト横取りで取得し(URL は使い捨てなので iframe 側は abort)、トップレベルで開く。
//   3. Controls を展開 → input[aria-label="Enter a date"] ×2 に開始日・終了日を入力
//   4. 「利用ログ」テーブルにホバー → [aria-label="Menu options, 利用ログ, Table"]
//      → menuitem「Export to CSV」でダウンロード
//
// 環境まわり(リモート実行環境向け):
//   - 外向き HTTPS はプロキシ経由(HTTPS_PROXY)。Chromium には明示指定が必要
//   - プロキシが TLS を再終端するため CA を NSS ストアに登録(毎コンテナで必要)
//   - プロキシは Chromium の TLS1.3 ClientHello を処理できないため TLS1.2 上限を指定

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const LOGIN_URL = process.env.QOMMONS_URL || 'https://qommons.ai/login';
const EMAIL = process.env.QOMMONS_EMAIL;
const PASSWORD = process.env.QOMMONS_PASSWORD;

const here = path.dirname(new URL(import.meta.url).pathname);
const downloadsDir = path.join(here, 'downloads');
const debugDir = path.join(here, 'debug');
fs.mkdirSync(downloadsDir, { recursive: true });
fs.mkdirSync(debugDir, { recursive: true });

if (!EMAIL || !PASSWORD) {
  console.error('ERROR: QOMMONS_EMAIL / QOMMONS_PASSWORD が設定されていません。');
  process.exit(2);
}

const executablePath = process.env.QOMMONS_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

const launchArgs = ['--ssl-version-max=tls1.2'];
if (proxy && fs.existsSync('/root/.ccr/agent-proxy-ca.crt')) {
  try {
    execSync('which certutil || { apt-get update -qq && apt-get install -y -qq libnss3-tools; }', { stdio: 'pipe', timeout: 180000 });
    execSync('mkdir -p $HOME/.pki/nssdb && (certutil -d sql:$HOME/.pki/nssdb -L -n ccr-agent-proxy 2>/dev/null || certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n ccr-agent-proxy -i /root/.ccr/agent-proxy-ca.crt)', { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    console.error(`WARN: CA 証明書の NSS 登録に失敗: ${e.message}`);
  }
}

async function dumpDebug(page, tag) {
  try {
    await page.screenshot({ path: path.join(debugDir, `${tag}.png`), fullPage: true });
    fs.writeFileSync(path.join(debugDir, `${tag}.html`), await page.content());
    console.error(`debug: ${tag}.png / ${tag}.html を保存しました (${debugDir})`);
  } catch (e) {
    console.error(`debug dump failed: ${e.message}`);
  }
}

const browser = await chromium.launch({ executablePath, proxy, args: launchArgs });
const context = await browser.newContext({ acceptDownloads: true, locale: 'ja-JP' });
const page = await context.newPage();

try {
  // 1. ログイン
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[name="username"], input[type="email"], input[placeholder*="メール"]').first().fill(EMAIL, { timeout: 15000 });
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /ログイン|log ?in/i }).first().click();
  await page.waitForTimeout(5000);

  if (page.url().includes('/login')) {
    await dumpDebug(page, 'login-failed');
    throw new Error(`ログインに失敗した可能性があります(現在URL: ${page.url()})`);
  }

  // 2. 利用者ログ(QuickSight 埋め込み)の URL を横取りし、iframe 側は中断
  let embedUrl = null;
  await page.route('**quicksight.aws.amazon.com/embed/**', route => {
    if (!embedUrl) { embedUrl = route.request().url(); route.abort('aborted'); }
    else route.continue();
  });
  await page.goto('https://qommons.ai/log-dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 30 && !embedUrl; i++) await page.waitForTimeout(1000);
  if (!embedUrl) {
    await dumpDebug(page, 'no-embed-url');
    throw new Error('QuickSight 埋め込み URL を取得できませんでした(/log-dashboard の構成が変わった可能性)');
  }
  await page.unroute('**quicksight.aws.amazon.com/embed/**');

  // 3. QuickSight をトップレベルで開く
  await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(15000);

  // 4. Controls を展開して日付を当月1日〜当日(JST)に設定
  await page.locator('[aria-label="Controls"]').click().catch(() => {});
  await page.waitForTimeout(2000);
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const pad = n => String(n).padStart(2, '0');
  const start = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/01 00:00:00`;
  const end = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} 23:59:59`;
  const dates = page.locator('input[aria-label="Enter a date"]');
  await dates.nth(0).waitFor({ state: 'visible', timeout: 15000 });
  await dates.nth(0).fill(start); await dates.nth(0).press('Enter');
  await page.waitForTimeout(2000);
  await dates.nth(1).fill(end); await dates.nth(1).press('Enter');
  console.log(`期間設定: ${start} 〜 ${end}`);
  await page.waitForTimeout(15000); // データ再読み込み待ち

  // 5. 「利用ログ」テーブルにホバー → メニュー → Export to CSV
  const vis = page.locator('text=Table, 利用ログ').first();
  const box = await vis.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.waitForTimeout(2000);
  const menuBtn = page.locator('[aria-label="Menu options, 利用ログ, Table"]');
  await menuBtn.waitFor({ state: 'visible', timeout: 20000 });
  await menuBtn.click();
  await page.waitForTimeout(1500);
  const dl = page.waitForEvent('download', { timeout: 180000 });
  await page.locator('[role="menuitem"]:has-text("Export to CSV")').first().click();
  const download = await dl;
  const outPath = path.join(downloadsDir, `qommons-log-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`);
  await download.saveAs(outPath);
  console.log(`DOWNLOADED: ${outPath}`);
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  await dumpDebug(page, 'error');
  process.exitCode = 1;
} finally {
  await browser.close();
}
