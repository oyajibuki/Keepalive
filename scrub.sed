# 公開リポジトリに docs/last-run.log をコミットするため、
# 万一ログに混ざった資格情報をここで潰してから書き出す。
# Actions のログ画面と違い、コミットしたファイルには自動マスクが効かない。
s/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED-JWT]/g
s/hf_[A-Za-z0-9]{20,}/[REDACTED-HF-TOKEN]/g
s/gh[posru]_[A-Za-z0-9]{20,}/[REDACTED-GH-TOKEN]/g
s/sb_(publishable|secret)_[A-Za-z0-9_-]{20,}/[REDACTED-SUPABASE-KEY]/g
s/(apikey|api_key|access_token|authorization)([=:] ?"?)[A-Za-z0-9._-]{20,}/\1\2[REDACTED]/gi
