/**
 * Supabase プロジェクトの一時停止を防ぐ。
 *
 * 無料プランは「7日間、活動が少ない」と一時停止される。
 * ログイン後にしかクエリを投げないアプリ（FitSign）や、
 * 家族しか使わないアプリ（NekoBase）はブラウザ巡回では活動が作れないので、
 * REST API に直接クエリを投げて実際に Postgres へ到達させる。
 *
 * 使うのは anon キー（クライアントに埋め込む前提の公開鍵）。
 * service_role キーは絶対に使わないこと。全 RLS を無視できる管理者権限であり、
 * 漏れると DB を丸ごと操作されてしまう。
 *
 * 設定は urls.json の supabase（配列）。1件ずつこう書く:
 *   {
 *     "name":   "表示名",
 *     "url":    "https://xxxx.supabase.co",
 *     "table":  "叩くテーブル名",
 *     "keyEnv": "SUPABASE_ANON_KEY"      … Secret から読む場合
 *     "key":    "eyJ..."                  … 直書きする場合（どちらか一方）
 *   }
 *
 * key を直書きしてよいのは「すでに公開されている anon キー」だけ。
 * アプリのバイナリに埋め込んで配っているものは、隠しても意味がないので直書きでよい。
 * 逆に、まだどこにも出していない鍵は keyEnv（GitHub Secrets）にすること。
 */
const fs = require('fs');
const path = require('path');
const { writeResults } = require('./results');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'urls.json'), 'utf8'));

// URL は秘密情報ではない（アプリの通信を見れば分かる）ので urls.json だけを見る。
// Secret から読む方式は値がマスクされて中身を確認できず、
// 打ち間違いがあっても原因が追えないため採用しない。
function normalizeUrl(raw) {
  if (!raw) return null;
  let v = String(raw).trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v; // プロトコル抜けを補う
  try {
    new globalThis.URL(v);
    return v;
  } catch {
    return null;
  }
}

/** 昔の書き方（オブジェクト1件）でも動くようにそろえる */
function projects() {
  const raw = CONFIG.supabase;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry, index) => ({
    name: entry.name || `Supabase ${index + 1}`,
    url: normalizeUrl(entry.url),
    table: entry.table || 'users',
    key: (entry.key || process.env[entry.keyEnv || 'SUPABASE_ANON_KEY'] || '').trim(),
  }));
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${stamp()}]`, ...a);

async function ping(project) {
  const label = `${project.name} (${project.table})`;

  if (!project.url || !project.key) {
    const missing = [!project.url && 'url', !project.key && 'anon キー'].filter(Boolean);
    log(`⏭️ SKIP — ${label} — 未設定: ${missing.join(', ')}`);
    return { id: `supabase-${project.name}`, label, type: 'supabase', status: 'SKIP', note: `未設定: ${missing.join(', ')}` };
  }

  const endpoint = `${project.url}/rest/v1/${project.table}?select=*&limit=1`;
  let status = 'OK';
  let note = '';

  try {
    const res = await fetch(endpoint, {
      headers: { apikey: project.key, Authorization: `Bearer ${project.key}` },
    });
    const body = await res.text();
    note = `HTTP ${res.status}`;

    // 目的は「Postgres まで到達させて活動を作ること」であって、行を読むことではない。
    // そのため権限拒否 (42501) や RLS による空配列も成功とみなす。
    //   42501            … PostgREST が Postgres に接続して拒否された = 到達済み
    //   Invalid API key  … API ゲートウェイで弾かれた = 未到達。これは失敗
    const denied = body.includes('"42501"');
    const invalidKey = body.includes('Invalid API key');

    if (res.ok) {
      note += ` / クエリ到達 (${body.length} bytes)`;
    } else if (denied) {
      note += ' / 権限なしだが Postgres に到達（keep-alive としては有効）';
    } else if (invalidKey) {
      status = 'FAIL';
      note += ' / APIキーが無効です';
    } else if (res.status === 404) {
      status = 'FAIL';
      note += ` / テーブル "${project.table}" が見つかりません（urls.json を確認）`;
    } else if (res.status >= 500) {
      status = 'FAIL';
      note += ' / プロジェクトが停止中の可能性があります';
    } else {
      status = 'WARN';
      note += ` / 想定外の応答: ${body.slice(0, 80)}`;
    }
  } catch (e) {
    status = 'FAIL';
    note = e.message;
  }

  const icon = status === 'OK' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  log(`${icon} ${status} — ${label} — ${note}`);
  return { id: `supabase-${project.name}`, label, type: 'supabase', status, note };
}

(async () => {
  const list = projects();

  if (list.length === 0) {
    log('⏭️ スキップ — urls.json に supabase の設定がありません');
    writeResults('supabase', []);
    return;
  }

  const items = [];
  for (const project of list) {
    items.push(await ping(project));
  }

  writeResults('supabase', items);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = items
      .map((i) => `| ${i.status === 'OK' ? '✅' : i.status === 'SKIP' ? '⏭️' : '❌'} ${i.status} | ${i.label} | ${i.note} |`)
      .join('\n');
    fs.appendFileSync(summary, `## Supabase (${stamp()} UTC)\n\n| 結果 | プロジェクト | 備考 |\n|---|---|---|\n${rows}\n\n`);
  }

  // 1つでも落ちていたら失敗として扱う（SKIP は未設定なので失敗にしない）
  if (items.some((i) => i.status === 'FAIL')) process.exit(1);
})();
