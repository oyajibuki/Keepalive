# Keepalive

Streamlit Community Cloud / Hugging Face Spaces のアプリがスリープするのを防ぐツール。

## なぜ必要か

Streamlit Community Cloud の「起きている判定」は HTTP GET ではなく、
**ブラウザが WebSocket で接続したかどうか**で決まる。

そのため GAS の `UrlFetchApp.fetch()` や `curl` では防げない。
JS が実行されないので WebSocket が張られず、Streamlit 側からは「誰も来ていない」ままになる。
しかも "Zzzz"（スリープ）画面自体が **HTTP 200** を返すため、
ログ上は「成功」でも実際は寝ている、という状態が起きる。

このリポジトリは Playwright で本物の Chromium を起動し、

1. ページを開く
2. `Yes, get this app back up!` が出ていたらクリックして起こす
3. 25 秒滞在して WebSocket 接続を維持し、`wss://.../_stcore/stream` が
   実際に張られたことを検証する

ところまでを GitHub Actions で自動実行する。

なお Streamlit のアプリ本体は `https://<app>.streamlit.app/~/+/` という
**iframe の中**にある。外側のページの DOM を見ても中身は空なので、
起床ボタンは全フレームを走査して探し、生存確認は WebSocket で行っている。

## Hugging Face Spaces の場合

Streamlit とは挙動が違う。実測した結果は以下のとおり。

| 訪問先 | 結果 |
|---|---|
| `https://huggingface.co/spaces/<owner>/<name>` | ❌ 起きない。"Restart this Space" が出るだけ |
| `https://<owner>-<name>.hf.space/` | ✅ 起きる。`SLEEPING` → `APP_STARTING` → `RUNNING` |

つまり**本体ドメインを直接叩く必要がある**。
`urls.json` の `hfSpaces` に repo id を書けば、
[`keep-alive.js`](keep-alive.js) が `hf.space` の URL を自動生成して訪問する。

無料の `cpu-basic` は `gcTimeout = 172800`（**48時間**）で寝るため、
**cron は必ず 48 時間より短い間隔**にすること。

[`hf-restart.js`](hf-restart.js) は補助。`HF_TOKEN`（write 権限）を
リポジトリの Secrets に登録しておくと restart API で確実に叩き起こす。
未設定でも動作し、その場合はブラウザ訪問による起床に任せる。

## Supabase が止まる場合

無料プランは「7日間、活動が少ない」と一時停止される。

FitSign のように **Google ログイン後にしか Supabase へクエリを投げない**アプリは、
ブラウザで巡回しても Supabase 側には何も届かないため止まってしまう。
かといってログインを自動化するのは、パスワードと2段階認証をリポジトリに置くことになり、
Google 側のブロック対象にもなるので採用しない。

代わりに [`supabase-ping.js`](supabase-ping.js) が REST API へ直接クエリを投げ、
Postgres まで到達させて活動を作る。**ログインは不要**。

設定は2箇所に分かれている。

| 項目 | 置き場所 | 理由 |
|---|---|---|
| URL | [`urls.json`](urls.json) の `supabase.url` | 秘密情報ではない。アプリの通信を見れば分かる |
| anon キー | Secrets の `SUPABASE_ANON_KEY` | 公開鍵とはいえリポジトリに直書きはしない |

キーが未登録ならスキップされる（失敗にはならない）。

> ⚠️ **`service_role` キーは絶対に使わないこと。**
> 全 RLS を無視できる管理者権限で、漏れると DB を丸ごと操作されてしまう。
> anon キーはもともとクライアントに埋め込む前提の公開鍵なので、こちらを使う。

叩くテーブルは `urls.json` の `supabase.table` で変更できる。
RLS で行が返らなくてもクエリ自体は Postgres に到達するので、活動としては有効。

## 対象URLの変更

[`urls.json`](urls.json) を編集して push するだけ。

```json
{
  "urls": [
    "https://fit-sign.streamlit.app/"
  ],
  "hfSpaces": [
    "AutoCraft502/ai-subtitle"
  ]
}
```

`urls` は実ブラウザで開く対象、`hfSpaces` は HF Space の repo id。

## 実行スケジュール

[`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) の cron で設定。
デフォルトは **毎日 09:00 JST**（HF の 48 時間制限に対する安全マージン）。

手動実行は Actions タブ → `Keep Alive` → `Run workflow`。

## 結果の確認

各実行の **Summary** に結果表が出る。

| 結果 | 起床させた | URL | 備考 |
|---|---|---|---|
| ✅ OK | — | https://... | HTTP 200 |

失敗した場合は Artifacts にスクリーンショットが残り、
GitHub から通知メールが届く。

## ⚠️ 注意：60日ルール

GitHub Actions の `schedule` は、**リポジトリに60日間アクティビティが無いと自動停止**する。
停止すると GitHub からメールが来るので、その際は Actions タブから再有効化するか、
何かコミットを入れること。

## ローカル実行

```bash
npm install
npx playwright install chromium
node keep-alive.js
```

## 前提

対象アプリは **公開設定 (public)** であること。
非公開アプリは Google ログインへ 303 リダイレクトされ、このツールでは到達できない。
（ログイン自動化はパスワードをリポジトリに置くことになるため非推奨）
