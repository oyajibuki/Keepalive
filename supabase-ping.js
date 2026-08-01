/**
 * Supabase プロジェクトの一時停止を防ぐ。
 *
 * 無料プランは「7日間、活動が少ない」と一時停止される。
 * FitSign は Google ログイン後にしか Supabase へクエリを投げないため、
 * ブラウザで巡回しても Supabase 側には何も届かず、止まってしまう。
 *
 * そこで REST API に直接クエリを投げ、実際に Postgres へ到達させる。
 * ログインは一切不要。
 *
 * 使うのは anon キー（クライアントに埋め込む前提の公開鍵）。
 * service_role キーは絶対に使わないこと。全 RLS を無視できる管理者権限であり、
 * 漏れると DB を丸ごと操作されてしまう。
 *
 * 設定:
 *   URL … urls.json の supabase.url（秘密情報ではないため直書きでよい）
 *         環境変数 SUPABASE_URL があればそちらを優先
 *   KEY … 環境変数 SUPABASE_ANON_KEY（GitHub Secrets に登録する）
 */
const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'urls.json'), 'utf8'));
const TABLE = (CONFIG.supabase && CONFIG.supabase.table) || 'users';

// URL は秘密情報ではない（アプリの通信を見れば分かる）ので urls.json に置く。
// 環境変数が指定されていればそちらを優先する。
const URL = (process.env.SUPABASE_URL || (CONFIG.supabase && CONFIG.supabase.url) || '')
  .replace(/\/+$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

(async () => {
  if (!URL || !KEY) {
    const missing = [
      !URL && 'SUPABASE_URL (env または urls.json の supabase.url)',
      !KEY && 'SUPABASE_ANON_KEY (Secret)',
    ].filter(Boolean);
    log(`⏭️ スキップ — 未設定の Secret: ${missing.join(', ')}`);
    log('→ Settings > Secrets and variables > Actions で登録してください。');
    return; // 未設定は失敗扱いにしない
  }

  const endpoint = `${URL}/rest/v1/${TABLE}?select=*&limit=1`;
  let status = 'OK';
  let note = '';

  try {
    const res = await fetch(endpoint, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    note = `HTTP ${res.status}`;

    // RLS で行が返らなくてもクエリ自体は Postgres に到達しており、活動として記録される。
    // 401/404 は設定ミスなので気付けるようにする。
    if (res.status === 401 || res.status === 403) {
      status = 'FAIL';
      note += ' / キーが無効か権限不足です';
    } else if (res.status === 404) {
      status = 'FAIL';
      note += ` / テーブル "${TABLE}" が見つかりません（urls.json の supabase.table を確認）`;
    } else if (res.status >= 500) {
      status = 'FAIL';
      note += ' / プロジェクトが停止中の可能性があります';
    } else {
      const body = await res.text();
      note += ` / クエリ到達 (${body.length} bytes)`;
    }
  } catch (e) {
    status = 'FAIL';
    note = e.message;
  }

  const icon = status === 'OK' ? '✅' : '❌';
  log(`${icon} ${status} — ${TABLE} — ${note}`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      `## Supabase (${stamp()} UTC)\n\n` +
        `| 結果 | テーブル | 備考 |\n|---|---|---|\n| ${icon} ${status} | ${TABLE} | ${note} |\n\n`
    );
  }

  if (status === 'FAIL') process.exit(1);
})();
