/**
 * 各チェックスクリプトの結果を一時ファイルに書き出す共通処理。
 * report.js がこれらを拾って docs/history.json にまとめる。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '.results');

/**
 * @param {string} kind  browser | hf | supabase
 * @param {Array<{id:string,label:string,type:string,status:string,note:string}>} items
 */
function writeResults(kind, items) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIR, `${kind}.json`),
    JSON.stringify({ kind, at: new Date().toISOString(), items }, null, 2)
  );
}

module.exports = { writeResults, RESULTS_DIR: DIR };
