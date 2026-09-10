# IMDBプロフィール生成・承認ワークフロー

## 目的

Googleスプレッドシートへグループ名を入力すると、GitHub ActionsからCodex Cloud Agentを起動し、日本語プロフィールと不足項目の調査結果を確認用の行へ書き戻します。人が `approved` にした行だけをSupabaseへ反映します。

CSVの出力とローカルPCでのコマンド実行は不要です。

## 処理の境界

```text
Google Sheet (queued)
  -> GitHub Actions
  -> Codex Cloud Agent（調査・原稿生成のみ）
  -> Google Sheet (review)
  -> 人が確認・修正して approved
  -> GitHub Actions
  -> Supabase (published)
```

- CodexにはSupabaseの書き込みキーを渡しません。
- 空の調査結果で既存DB値を削除しません。
- プロフィール本文、出典数、URL、slug、日付形式を公開前に検証します。
- DB更新は冪等なupsertです。途中で失敗した行は `publish_error` になり、修正後に `approved` へ戻して再実行できます。
- 既存のCSVインポーターとは独立して動作します。

## 1. Google側の準備

1. Google Cloudでサービスアカウントを作成します。
2. Google Sheets APIを有効にします。
3. 対象スプレッドシートをサービスアカウントのメールアドレスへ「編集者」として共有します。
4. サービスアカウントキーJSONを取得し、次のコマンドでBase64化します。

```bash
base64 < service-account.json | tr -d '\n'
```

既存のMASTERシートと同じスプレッドシートを使えます。自動処理は既定で `IMDB_PROFILE_WORKFLOW` という別タブだけを操作します。

## 2. GitHub Secrets

リポジトリの Settings > Secrets and variables > Actions に次を登録します。

| 種別 | 名前 | 用途 |
|---|---|---|
| Secret | `CURSOR_API_KEY` | Cursor SDKからCloud Agentを起動 |
| Secret | `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Google Sheetsのサービスアカウント |
| Secret | `GOOGLE_WORKFLOW_SPREADSHEET_ID` | スプレッドシートURLの `/d/` と `/edit` の間の値 |
| Secret | `SUPABASE_URL` | SupabaseプロジェクトURL |
| Secret | `SUPABASE_READ_KEY` | 既存値の取得専用。publishable/anon keyを使用（ローカルでは既存の `SUPABASE_ANON_KEY` も利用可） |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | 承認済み行の公開専用 |

`SUPABASE_SERVICE_ROLE_KEY` は公開ジョブのステップだけに渡されます。Google SheetやCodex Cloud Agentには渡りません。

## 3. GitHub Variables

| 名前 | 推奨初期値 | 用途 |
|---|---|---|
| `GOOGLE_WORKFLOW_SHEET_NAME` | `IMDB_PROFILE_WORKFLOW` | 操作対象タブ |
| `CURSOR_MODEL` | `auto` | SDKで使うモデル。精度比較時は固定モデルIDを指定 |
| `IMDB_PROFILE_PUBLISH_ENABLED` | `false` | `true` のときだけSupabase公開ジョブを有効化 |

最初の精度検証中は `IMDB_PROFILE_PUBLISH_ENABLED=false` のままにします。

Cursor側では、APIキーの所有者またはサービスアカウントがGitHubリポジトリを読み取れるようにGitHub連携も有効にしてください。Cloud Agentは指定されたコミットをクラウドVMへcloneして実行します。

## 4. シートの初期化

GitHub Actionsの `IMDB profile workflow` を開き、`Run workflow` で `mode=setup` を実行します。タブとヘッダー、ステータスのプルダウンが作成されます。

ローカルで初期化する場合は、環境変数を設定して次を実行します。

```bash
npm run profile:sheet:setup
```

## 5. 原稿を生成する

シートへ新しい行を追加します。

| 列 | 入力内容 |
|---|---|
| `group_name` | 必須。例: `Tri-Sphere` |
| `group_slug` | 既存グループは入力推奨。空なら完全一致検索またはCodex提案値を使用 |
| `request_type` | 任意。`create` / `update`。空でも可 |
| `status` | `queued` |

30分ごとの定期実行、または `mode=generate` の手動実行で処理されます。

成功すると `status=review` になり、次の情報が行へ入ります。

- `profile_ja`: DBへ登録する編集可能な本文
- `overview_ja` / `musical_style_ja`: 生成時の内訳
- メンバー、活動拠点、所属、活動開始月
- 公式サイト・SNS・配信サービスURL
- `sources_json`: 出典一覧
- `field_evidence_json`: 項目と根拠URLの対応
- 信頼度、注意事項、既存DB値、Agent/Run ID

生成失敗時は `generation_error` と `last_error` を確認し、修正後に `queued` へ戻します。

## 6. 確認して公開する

1. `profile_ja` と各項目を直接修正します。
2. `sources_json` と `field_evidence_json` で根拠を確認します。
3. `group_slug` が正しい既存グループを指すか確認します。
4. `status` を `approved` にします。

公開機能を有効にする前は、ローカルでプレビューできます。

```bash
npm run profile:publish
```

実際にDBへ反映する明示指定は次のとおりです。

```bash
npm run profile:publish -- --apply
```

GitHub Actionsで公開する場合は、5〜10組の検証後にRepository Variable `IMDB_PROFILE_PUBLISH_ENABLED` を `true` にします。承認済み行は定期実行後に `published` になります。

## 7. ステータス一覧

| status | 意味 |
|---|---|
| `queued` | 生成待ち |
| `generating` | Codexが処理中 |
| `review` | 人による確認待ち |
| `approved` | DB公開を承認済み |
| `publishing` | DB更新中 |
| `published` | DB更新完了 |
| `generation_error` | 生成・検証失敗 |
| `publish_error` | DB更新失敗 |

## 8. 精度検証

最初はTri-Sphereを含む性質の異なる5〜10組で、同一性、事実、出典、文章の粒度、未確認値の扱いを確認します。調査・執筆ルールは [`prompts/imdb_profile_research.md`](../prompts/imdb_profile_research.md) でバージョン管理します。
