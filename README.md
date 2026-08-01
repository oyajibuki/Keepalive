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

## 対象URLの変更

[`urls.json`](urls.json) を編集して push するだけ。

```json
{
  "urls": [
    "https://fit-sign.streamlit.app/"
  ]
}
```

## 実行スケジュール

[`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) の cron で設定。
デフォルトは **2日おき 09:00 JST**。

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
