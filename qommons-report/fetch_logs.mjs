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

const BASE_URL = process.env.QOMMONS_URL || 'https://qommons.ai/';
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

const executablePath = process.env.QOMMONS_CHROMIUM_PATH || undefined;

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

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ acceptDownloads: true, locale: 'ja-JP' });
const page = await context.newPage();

try {
  // 1. ログインページへ
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // すでにログインフォームでなければ「ログイン」リンクを探す
  const emailInput = page.locator(
    'input[type="email"], input[name*="mail" i], input[placeholder*="メール"], input[autocomplete="username"]'
  );
  if (!(await emailInput.first().isVisible({ timeout: 3000 }).catch(() => false))) {
    await clickFirst(page, [
      page.getByRole('link', { name: /ログイン|log ?in|sign ?in/i }),
      page.getByRole('button', { name: /ログイン|log ?in|sign ?in/i }),
    ], 'ログインリンク');
    await page.waitForTimeout(2000);
  }

  // 2. ログイン
  await emailInput.first().fill(EMAIL, { timeout: 15000 });
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await clickFirst(page, [
    page.getByRole('button', { name: /ログイン|log ?in|sign ?in|送信/i }),
    page.locator('button[type="submit"], input[type="submit"]'),
  ], 'ログインボタン');
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  if (await page.locator('input[type="password"]').first().isVisible().catch(() => false)) {
    await dumpDebug(page, 'login-failed');
    throw new Error('ログインに失敗した可能性があります(パスワード欄が残っています)');
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
