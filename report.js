/**
 * 各スクリプトが .results/ に残した結果を 1 回分の実行としてまとめ、
 * docs/history.json に追記する。ダッシュボードはこの JSON だけを読む。
 *
 * 履歴は MAX_RUNS 件で打ち切る。毎日 1 回なので約 3 ヶ月分。
 */
const fs = require('fs');
const path = require('path');
const { RESULTS_DIR } = require('./results');

const HISTORY = path.join(__dirname, 'docs', 'history.json');
const MAX_RUNS = 90;

function loadHistory() {
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
    if (Array.isArray(h.runs)) return h;
  } catch {
    /* 初回は存在しない */
  }
  return { runs: [] };
}

function collectItems() {
  let items = [];
  for (const kind of ['hf', 'supabase', 'browser']) {
    const file = path.join(RESULTS_DIR, `${kind}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      items = items.concat(JSON.parse(fs.readFileSync(file, 'utf8')).items || []);
    } catch (e) {
      console.error(`${kind}.json の読み込みに失敗: ${e.message}`);
    }
  }
  return items;
}

const items = collectItems();
if (!items.length) {
  console.error('結果が 1 件もありません。履歴は更新しません。');
  process.exit(0);
}

const history = loadHistory();

// 1 回分の実行を { URL: 結果 } の形で記録する
const run = {
  at: new Date().toISOString(),
  runId: process.env.GITHUB_RUN_ID || null,
  results: {},
};
for (const it of items) {
  run.results[it.id] = { status: it.status, note: it.note };
}

history.runs.push(run);
history.runs = history.runs.slice(-MAX_RUNS);
history.updated = run.at;

// 対象一覧は「現在の設定」を正とする（削除した URL は履歴から自然に消える）
history.targets = items.map((it) => ({ id: it.id, label: it.label, type: it.type }));

history.repo = process.env.GITHUB_REPOSITORY || 'oyajibuki/Keepalive';

fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2));

const counts = items.reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {});
console.log(
  `履歴を更新しました: ${history.runs.length} 回分 / 対象 ${items.length} 件 ` +
    `(${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')})`
);
