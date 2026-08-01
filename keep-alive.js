/**
 * Keep-Alive: 実ブラウザで各アプリを開き、スリープを防ぐ。
 *
 * GAS の UrlFetchApp では JS が実行されず WebSocket が張られないため、
 * Streamlit Community Cloud は「誰も来ていない」と判定してスリープする。
 * このスクリプトは Playwright で本物の Chromium を起動し、
 *   1. ページを開く
 *   2. "Yes, get this app back up!" が出ていたら押して起こす
 *   3. アプリが描画されるまで待ち、さらに一定時間滞在して WebSocket を維持する
 * ところまでやる。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URLS = JSON.parse(fs.readFileSync(path.join(__dirname, 'urls.json'), 'utf8')).urls;

const NAV_TIMEOUT = 60_000;   // ページ遷移のタイムアウト
const WAKE_TIMEOUT = 120_000; // 起床ボタンを押してからアプリが立ち上がるまでの待ち上限
const DWELL_MS = 25_000;      // WebSocket を維持するための滞在時間
const SHOT_DIR = path.join(__dirname, 'screenshots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

const WAKE_BUTTON = /get this app back up/i;

/**
 * スリープ画面の起床ボタンを探す。
 * Streamlit のアプリ本体は iframe (/~/+/) の中にあるため、全フレームを見る。
 */
async function findWakeButton(page) {
  for (const frame of page.frames()) {
    try {
      const btn = frame.getByRole('button', { name: WAKE_BUTTON });
      if ((await btn.count()) > 0) return btn;
    } catch {
      /* フレームが遷移中なら無視 */
    }
  }
  return null;
}

async function visit(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const result = { url, status: 'OK', woke: false, note: '' };

  // Streamlit の生存判定そのものである WebSocket 接続を監視する。
  // DOM を覗くより確実で、iframe 構造の変更にも影響されない。
  let streamSocket = false;
  page.on('websocket', (ws) => {
    if (ws.url().includes('_stcore/stream')) streamSocket = true;
  });

  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    result.note = `HTTP ${res ? res.status() : '?'}`;

    // iframe の読み込みを待ってから起床ボタンを探す
    await sleep(5_000);
    const btn = await findWakeButton(page);

    if (btn) {
      log(`  → スリープ中。起こします: ${url}`);
      result.woke = true;
      await btn.click();

      // 起床には数十秒かかる。ボタンが消えるまで粘る。
      const deadline = Date.now() + WAKE_TIMEOUT;
      let still = true;
      while (Date.now() < deadline) {
        await sleep(5_000);
        still = (await findWakeButton(page)) !== null;
        if (!still) break;
      }
      if (still) {
        result.status = 'FAIL';
        result.note += ' / 起床タイムアウト';
      }
    }

    // ここが本題：WebSocket を張ったまま滞在し、アクセスがあった事実を残す
    await sleep(DWELL_MS);
    result.title = await page.title();

    // Streamlit アプリは WebSocket が張れて初めて「起きている」と見なされる
    if (result.status === 'OK' && url.includes('streamlit.app')) {
      if (streamSocket) {
        result.note += ' / WebSocket 接続確認';
      } else {
        result.status = 'WARN';
        result.note += ' / WebSocket 未接続';
      }
    }
  } catch (e) {
    result.status = 'FAIL';
    result.note = e.message.split('\n')[0];
  }

  if (result.status !== 'OK') {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const file = path.join(SHOT_DIR, url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) + '.png');
    await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  }

  await context.close();
  return result;
}

(async () => {
  log(`対象 ${URLS.length} 件`);
  const browser = await chromium.launch();
  const results = [];

  for (const url of URLS) {
    log(`訪問: ${url}`);
    const r = await visit(browser, url);
    const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
    log(`  ${icon} ${r.status}${r.woke ? ' (起床させました)' : ''} — ${r.note}`);
    results.push(r);
  }

  await browser.close();

  // GitHub Actions のサマリに表を出す
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = results
      .map((r) => {
        const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
        return `| ${icon} ${r.status} | ${r.woke ? 'はい' : '—'} | ${r.url} | ${r.note} |`;
      })
      .join('\n');
    fs.appendFileSync(
      summary,
      `## Keep-Alive 実行結果 (${stamp()} UTC)\n\n` +
        `| 結果 | 起床させた | URL | 備考 |\n|---|---|---|---|\n${rows}\n`
    );
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  if (failed.length) {
    log(`失敗 ${failed.length} 件`);
    process.exit(1); // 失敗時は GitHub から通知メールが届く
  }
  log('全件完了');
})();
