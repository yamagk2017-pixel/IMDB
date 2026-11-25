# IMDBプロフィール生成・承認ワークフロー

## 更新経路の必須ルール

ユーザーが通常フロー以外での作業を特別に明示指示した場合を除き、IMDBの登録・更新は必ず本書の調査・検証・`IMDB_PROFILE_WORKFLOW` でのレビューと承認・公開・読み戻し検証に従います。チャットの「更新してください」「approved」だけでは、シート上の承認や調査・検証を省略しません。公開前に対象行の `request_id` と `status=approved` を確認します。

DB・MASTERへの直接編集やCSVインポート等を迂回経路として使いません。本書に記載する従来の手動インポート機能も、Codexが使う場合はユーザーによる例外の明示指示が必要です。通常フローが実行できない場合は、原因と未反映の範囲を報告し、独断で別経路へ切り替えません。例外許可は指示された対象と操作に限り、別の更新へ引き継ぎません。

エージェントの継続的な作業ルールは [`AGENTS.md`](../AGENTS.md) に記載しています。

## 目的と現行フロー

プロフィールの調査・作成はCodexが行います。2026年11月24日、Geminiによる生成経路を廃止しました。30分ごとの定期実行、`mode=generate`、`mode=all` はありません。既存の `profile:generate` コマンドも、APIやシートへアクセスせず廃止案内を出して終了します。

```text
ユーザーがCodexへ調査・作成を依頼
  -> CodexがWeb調査・出典確認・原稿作成・URL確認
  -> 構造と根拠をローカル検証
  -> IMDB_PROFILE_WORKFLOW (review)
  -> ユーザーが確認・修正して approved
  -> GitHub Actionsをrequest_id指定で手動実行
  -> MASTER_testへ転記
  -> Supabaseへ反映・読み戻し検証
  -> IMDB_PROFILE_WORKFLOW (published)
```

Codexでの調査・レビュー行作成は `.agents/skills/imdb-profile/SKILL.md`、調査・執筆仕様は `prompts/imdb_profile_research.md` に従います。最初の依頼では `review` まで進め、ユーザーのシート上の承認操作を待ちます。承認後の公開では、対象行の `request_id` と `status=approved` を読み直します。

## GitHub Actionsの動作

`IMDB profile workflow` は手動実行のみです。

- `mode=publish`（既定）: 指定した `request_id` の承認済み行だけを公開します。IDが空なら、MASTER・DBへの反映前にエラーで停止します。
- `mode=setup`: シートの初期化・入力規則の設定を行います。通常のプロフィール更新では使いません。
- 定期生成・定期公開はありません。シートを `approved` にしただけでは公開されません。
- GeminiのAPIキーやモデル設定はジョブへ渡しません。

公開用ワークフローは常時有効にし、公開終了後も無効化しません。2026年11月25日のユーザー指示により、更新のたびの有効化確認は不要です。無効の場合は、Gemini生成・定期実行を含まない手動実行専用の構成を確認して、Codexが通常作業として再有効化します。ユーザーによる別途の停止指示がある場合は、その指示を優先します。

ユーザーがシートで内容を承認したら、Codexは対象行の `request_id` と `status=approved` を読み直し、追加の公開確認なしでその対象だけを手動公開します。シート上の内容承認と、公開後の読み戻し検証は維持します。有効化だけではジョブは起動せず、シートを `approved` にするだけでも起動しません。

## Google・GitHubの準備

Google Sheets用サービスアカウントを作成し、Sheets APIを有効にして、対象スプレッドシートをそのアカウントに編集者として共有します。サービスアカウントの認証情報をGitHub Secretへ登録します。秘密鍵はソースコード・シート・チャットへ貼り付けません。

公開ジョブが利用するGitHub Secrets:

- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`: Google Sheets用認証情報
- `GOOGLE_WORKFLOW_SPREADSHEET_ID`: 対象スプレッドシートID
- `SUPABASE_URL`: SupabaseプロジェクトURL
- `SUPABASE_SERVICE_ROLE_KEY`: 承認済み行の公開専用キー

GitHub Variables:

- `GOOGLE_WORKFLOW_SHEET_NAME`: `IMDB_PROFILE_WORKFLOW`
- `GOOGLE_MASTER_SHEET_NAME`: `MASTER_test`

旧設定の `GEMINI_API_KEY`、`GEMINI_MODEL`、`GEMINI_FALLBACK_MODEL`、`SUPABASE_READ_KEY`、`IMDB_PROFILE_PUBLISH_ENABLED` は、このワークフローでは参照しません。他の利用元を確認せず、共有キーの失効・削除は行いません。ローカルの読み取り処理では引き続きSupabaseの読み取り設定を利用する場合があります。

## シートの初期化

GitHub Actionsの `Run workflow` で `mode=setup` を実行します。ローカルの場合はGoogle認証情報等を設定して `npm run profile:sheet:setup` を実行します。

## Codexによる原稿作成

対象グループのプロフィール作成・更新をCodexへ依頼します。Codexは既存MASTERの照合と重複依頼の確認、Web調査、出典確認、原稿とURLの検証を行い、`npm run profile:codex:validate` で検証済みの行を `review` として登録します。`queued` の行は新規作成しません。既存の生成待ち行も自動処理されません。

レビュー行には次の情報を記録します。

- `profile_ja`: 編集可能な本文。`概要` と `音楽性` の見出し付き
- `overview_ja` / `musical_style_ja`: 本文の内訳
- メンバー、活動拠点、所属、活動開始月
- 公式サイト・SNS・配信サービス・カレンダー・TicketDiveのURL
- `sources_json` / `field_evidence_json`: 出典と各項目の根拠
- 信頼度、注意事項、既存MASTER値、Codexによる作成情報

確認できない情報は空欄とし、理由を `warnings_json` に残します。カレンダー・TicketDiveはそれぞれ `calendar_url:`、`ticketdive_url:` から始まる理由を記載します。

Spotify Artist URLは必須確認項目です。取得できない場合でもレビュー行は作成しますが、`warnings_json` に `spotify_url:` から始まる警告、`identity_notes` と `review_note` に `【要対応】Spotify Artist URL未取得。` を記録します。

`members_ja` は全角スラッシュ（`／`）区切りです。Spotifyはレビュー行にアーティストURLを保持し、MASTERの `spotifyId` とDBの `external_ids.external_id` にはArtist IDを保存します。DBのSpotify `url` は保存しません。

## 確認と公開

1. ユーザーが本文・属性・URL・出典・警告・既存値との差分を確認し、必要なら修正します。
2. 対象グループと `group_slug` を確認し、シートの `status` を `approved` にします。
3. Codexが承認済み行を読み直し、GitHub Actionsで `mode=publish` と対象の `request_id` を指定して実行します。
4. 公開処理が `MASTER_test` を転記・更新し、DBへの反映内容を読み戻して照合します。
5. 検証成功後に公開処理が `published` と `published_at` を記録します。

ローカルで実行する場合も、同じ公開処理に対象IDを指定します。プレビューと適用の例:

```bash
PROFILE_WORKFLOW_REQUEST_ID=YOUR_APPROVED_REQUEST_ID PROFILE_WORKFLOW_REQUIRE_REQUEST_ID=true npm run profile:publish -- --max-rows=1
PROFILE_WORKFLOW_REQUEST_ID=YOUR_APPROVED_REQUEST_ID PROFILE_WORKFLOW_REQUIRE_REQUEST_ID=true npm run profile:publish -- --apply --max-rows=1
```

公開処理はslugをキーとする冪等なupsertです。既存行の任意項目は、レビュー行が空欄の場合に削除しません。途中で失敗した行は `publish_error` になります。エラー原因と部分反映の有無を確認し、ユーザーが再承認してから同じIDで再実行します。

従来の `MASTER_test` → CSV出力 → `script/import_master.ts` は互換機能として残っていますが、通常フローの迂回には使いません。Codexによる利用にはユーザーの特別な明示指示が必要です。

## ステータス

- `review`: ユーザーによる確認待ち
- `approved`: MASTER転記・DB公開を承認済み
- `publishing`: MASTER転記・DB更新中
- `published`: 転記・公開・読み戻し検証が完了
- `publish_error`: MASTER転記またはDB更新に失敗
- `queued` / `generating` / `generation_error`: 旧生成経路の履歴との互換性のために保持。新しい依頼では使用しません。
