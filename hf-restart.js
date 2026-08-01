/**
 * Hugging Face Spaces を起こす。
 *
 * 実測した挙動:
 *   - https://huggingface.co/spaces/<owner>/<name> (ラッパーページ) を見ても起きない。
 *     "Restart this Space" ボタンが出るだけ。
 *   - https://<owner>-<name>.hf.space/ (本体ドメイン) を訪問すると起きる。
 *     SLEEPING → APP_STARTING に遷移する。
 *
 * したがって通常は keep-alive.js のブラウザ訪問だけで足りる。
 * このスクリプトは補助で、HF_TOKEN があれば restart API で確実に叩き起こす。
 * トークンが無い場合は状態を報告するだけで、失敗にはしない。
 *
 * 無料の cpu-basic は gcTimeout = 172800 秒（48時間）で寝るため、
 * ワークフローは必ず 48 時間より短い間隔で回すこと。
 *
 * 任意の環境変数: HF_TOKEN (write 権限)
 */
const fs = require('fs');
const path = require('path');
const { writeResults } = require('./results');

const SPACES = JSON.parse(fs.readFileSync(path.join(__dirname, 'urls.json'), 'utf8')).hfSpaces || [];
const TOKEN = process.env.HF_TOKEN;
const API = 'https://huggingface.co/api/spaces';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

async function getRuntime(id) {
  const res = await fetch(`${API}/${id}`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`情報取得に失敗 (HTTP ${res.status})`);
  return (await res.json()).runtime || {};
}

async function handle(id) {
  const result = { id, status: 'OK', restarted: false, note: '' };
  try {
    let rt = await getRuntime(id);
    result.note = `stage=${rt.stage}`;

    // RUNNING / APP_STARTING は放置でよい
    if (rt.stage === 'RUNNING' || rt.stage === 'APP_STARTING') {
      log(`  ✅ 稼働中: ${id}`);
      return result;
    }

    // トークンが無くても keep-alive.js のブラウザ訪問で起きるので、失敗にはしない
    if (!TOKEN) {
      result.status = 'WARN';
      result.note += ' / HF_TOKEN 未設定 — このあとのブラウザ訪問で起床を試みます';
      return result;
    }

    log(`  → ${rt.stage}。restart API を実行: ${id}`);
    const res = await fetch(`${API}/${id}/restart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) {
      result.status = 'FAIL';
      result.note += ` / restart 失敗 (HTTP ${res.status})`;
      if (res.status === 401 || res.status === 403) {
        result.note += ' — トークンの権限を確認してください';
      }
      return result;
    }
    result.restarted = true;

    // 起動完了まで最大 5 分待つ
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await sleep(10_000);
      rt = await getRuntime(id);
      if (rt.stage === 'RUNNING') break;
      if (rt.stage === 'RUNTIME_ERROR' || rt.stage === 'BUILD_ERROR') {
        result.status = 'FAIL';
        result.note = `stage=${rt.stage} / アプリ側のエラーです`;
        return result;
      }
    }
    result.note = `stage=${rt.stage}`;
    if (rt.stage !== 'RUNNING') {
      result.status = 'WARN';
      result.note += ' / 起動待ちタイムアウト（バックグラウンドで継続中の可能性）';
    }
  } catch (e) {
    result.status = 'FAIL';
    result.note = e.message;
  }
  return result;
}

(async () => {
  if (!SPACES.length) return log('対象 Space なし');
  if (!TOKEN) {
    log('HF_TOKEN 未設定。状態確認のみ行い、起床は keep-alive.js のブラウザ訪問に任せます。');
  }

  log(`HF Spaces ${SPACES.length} 件`);
  const results = [];
  for (const id of SPACES) {
    log(`確認: ${id}`);
    const r = await handle(id);
    const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
    log(`  ${icon} ${r.status}${r.restarted ? ' (再起動しました)' : ''} — ${r.note}`);
    results.push(r);
  }

  writeResults(
    'hf',
    results.map((r) => ({
      id: `hf:${r.id}`,
      label: r.id,
      type: 'hf-api',
      status: r.status,
      note: r.note,
    }))
  );

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = results
      .map((r) => {
        const icon = r.status === 'OK' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
        return `| ${icon} ${r.status} | ${r.restarted ? 'はい' : '—'} | ${r.id} | ${r.note} |`;
      })
      .join('\n');
    fs.appendFileSync(
      summary,
      `## HF Spaces (${stamp()} UTC)\n\n` +
        `| 結果 | 再起動 | Space | 備考 |\n|---|---|---|---|\n${rows}\n\n`
    );
  }

  if (results.some((r) => r.status === 'FAIL')) process.exit(1);
})();
