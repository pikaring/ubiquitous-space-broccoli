// Qommons AI 利用ログ CSV 自動ダウンロードスクリプト
//
// 使い方:
//   node qommons-report/fetch_logs.mjs
//
// 必要な環境変数:
//   QOMMONS_EMAIL    ログイン用メールアドレス
//   QOMMONS_PASSWORD ログイン用パスワード
//   QOMMONS_URL      (任意) ログインページ URL。既定: https://qommons.ai/
//
// 出力:
//   qommons-report/downloads/ に CSV を保存し、パスを標準出力に出す。
//   失敗時は qommons-report/debug/ にスクリーンショットと HTML を保存して exit 1。
//
// 注意: Qommons AI の画面構成は初回実行時に確定していないため、セレクタは
// テキストベースのヒューリスティックで探す。UI が想定と違って失敗した場合は
// debug/ の内容を見てこのスクリプトを修正すること。

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.QOMMONS_URL || 'https://qommons.ai/login';
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

// プリインストール版 Chromium を使う(npm の playwright とバージョンが違っても動くように)
const executablePath = process.env.QOMMONS_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
// この環境の外向き HTTPS はプロキシ経由。Chromium は HTTPS_PROXY を読まないので明示指定する
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

// プロキシが TLS を再終端するため、Chromium にその CA を信頼させる必要がある
// (NSS ストアはコンテナ起動ごとに空になるので毎回確認する)。
// また上流プロキシは Chromium の TLS1.3 ClientHello を処理できず接続リセットに
// なるため、TLS1.2 を上限にする(証明書検証は有効なまま)。
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

// テキストで要素を探すヘルパー。複数候補を順に試す。
async function clickFirst(page, locators, desc) {
  for (const loc of locators) {
    const el = loc.first();
    try {
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        return true;
      }
    } catch { /* try next */ }
  }
  console.error(`WARN: ${desc} が見つかりませんでした`);
  return false;
}

const browser = await chromium.launch({ executablePath, proxy, args: launchArgs });
const context = await browser.newContext({ acceptDownloads: true, locale: 'ja-JP' });
const page = await context.newPage();

try {
  // 1. ログインページへ(https://qommons.ai/ は /login にリダイレクトされる)
  // 実測済みのフォーム構成 (2026-07-19):
  //   input[name="username"] placeholder="メールアドレス" / input[name="password"] / button「ログイン」
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const emailInput = page.locator(
    'input[name="username"], input[type="email"], input[placeholder*="メール"], input[autocomplete="username"]'
  );

  // 2. ログイン
  await emailInput.first().fill(EMAIL, { timeout: 15000 });
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await clickFirst(page, [
    page.getByRole('button', { name: /ログイン|log ?in|sign ?in|送信/i }),
    page.locator('button[type="submit"], input[type="submit"]'),
  ], 'ログインボタン');
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  if (page.url().includes('/login') || await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    await dumpDebug(page, 'login-failed');
    throw new Error(`ログインに失敗した可能性があります(現在URL: ${page.url()})`);
  }
  await dumpDebug(page, 'after-login');

  // 3. 画面左下のメニューからログを開く
  //    (左下のユーザー/設定メニュー → 「ログ」項目 という想定)
  await clickFirst(page, [
    page.getByRole('button', { name: /メニュー|設定|アカウント|menu/i }),
    page.locator('[class*="sidebar" i] button').last(),
    page.locator('nav button').last(),
  ], '左下メニュー');
  await page.waitForTimeout(1500);

  await clickFirst(page, [
    page.getByRole('menuitem', { name: /ログ/ }),
    page.getByRole('link', { name: /ログ/ }),
    page.getByText(/^ログ$|利用ログ|ログ管理/, { exact: false }).first(),
  ], 'ログメニュー項目');
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dumpDebug(page, 'log-page');

  // 4. 日付範囲を設定(当月1日〜今日。input[type=date] がある場合のみ)
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const ymd = (d) => d.toISOString().slice(0, 10);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const dateInputs = page.locator('input[type="date"]');
  const n = await dateInputs.count();
  if (n >= 2) {
    await dateInputs.nth(0).fill(ymd(monthStart));
    await dateInputs.nth(1).fill(ymd(today));
  } else if (n === 1) {
    await dateInputs.nth(0).fill(ymd(today));
  }

  // 5. CSV ダウンロード
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  const clicked = await clickFirst(page, [
    page.getByRole('button', { name: /csv|ダウンロード|エクスポート|出力/i }),
    page.getByRole('link', { name: /csv|ダウンロード|エクスポート|出力/i }),
  ], 'CSVダウンロードボタン');
  if (!clicked) {
    await dumpDebug(page, 'no-download-button');
    throw new Error('CSVダウンロードボタンが見つかりませんでした');
  }
  const download = await downloadPromise;
  const outPath = path.join(downloadsDir, `qommons-log-${ymd(today)}.csv`);
  await download.saveAs(outPath);
  console.log(`DOWNLOADED: ${outPath}`);
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  await dumpDebug(page, 'error');
  process.exitCode = 1;
} finally {
  await browser.close();
}
