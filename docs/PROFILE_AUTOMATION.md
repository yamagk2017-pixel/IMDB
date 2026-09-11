# IMDBプロフィール生成・承認ワークフロー

## 目的

日本語プロフィールと不足項目を調査し、確認用の行へ書き戻します。生成は、CodexチャットからCodex自身が行う方法と、GoogleスプレッドシートからGoogle Search付きのGemini APIへ依頼する従来方法の2通りです。人が `approved` にした行だけを正本の `MASTER_test` へ転記し、その後Supabaseへ反映します。

自動公開ではCSVの出力とローカルPCでのコマンド実行は不要です。一方、従来の `MASTER_test` → CSV出力 → `script/import_master.ts` という手動フローも維持します。

## 処理の境界

生成には2つの入口があります。どちらも `review` 以降は同じ承認・公開処理を使います。

### Codexチャット起点（Gemini APIを使わない）

```text
「◯◯というアイドルグループのプロフィールを作って」
  -> CodexがWeb調査・原稿生成・URL確認
  -> 構造と根拠をローカル検証
  -> Google Sheet (review)
  -> 人が確認・修正して approved
  -> GitHub Actions
  -> MASTER_test (upsert by slug)
  -> Supabase (published)
```

この入口ではCodexが直接生成するため、Gemini APIリクエストおよびGeminiの検索グラウンディング料金は発生しません。Codex自体のプラン・利用量は通常どおり消費します。プロジェクトスキル `.agents/skills/imdb-profile/SKILL.md` が、チャット上の依頼を調査と確認用行の作成へ変換します。Codexは安全のため `review` までしか進めません。

### スプレッドシート起点（既存のGemini経路）

```text
Google Sheet (queued)
  -> GitHub Actions
  -> Gemini API + Google Search（調査・原稿生成のみ）
  -> Google Sheet (review)
  -> 人が確認・修正して approved
  -> GitHub Actions
  -> MASTER_test (upsert by slug)
  -> Supabase (published)
```

- GeminiにはSupabaseの書き込みキーを渡しません。
- 空の調査結果で既存DB値を削除しません。
- プロフィール本文、出典数、URL、slug、日付形式を公開前に検証します。
- `MASTER_test` への転記とDB更新は冪等なupsertです。途中で失敗した行は `publish_error` になり、修正後に `approved` へ戻して再実行できます。
- 既存のCSVインポーターは、同じMASTER形式から引き続き実行できます。

## 1. Google側の準備

1. Google Cloudでサービスアカウントを作成します。
2. Google Sheets APIを有効にします。
3. 対象スプレッドシートをサービスアカウントのメールアドレスへ「編集者」として共有します。
4. サービスアカウントキーJSONを取得し、次のコマンドでBase64化します。

```bash
base64 < service-account.json | tr -d '\n'
```

既存のMASTERシートと同じスプレッドシートを使います。生成・確認は既定で `IMDB_PROFILE_WORKFLOW`、承認後の正本への転記は `MASTER_test` タブを操作します。

## 2. Gemini APIの準備

1. [Google AI Studio](https://aistudio.google.com/apikey)を開きます。
2. Google Cloudプロジェクト `imdb-automation-508212` を選択します。
3. APIキーを作成します。
4. 検索による根拠付けをAPIから利用するにはPaid Tierが必要です。固定月額ではなく従量課金で、初回は最低5米ドルのプリペイド設定になる場合があります。
5. 予期しない利用を防ぐため、Google Cloud側で予算アラートも設定します。

APIキーはスプレッドシート、ソースコード、チャットへ貼り付けません。次の手順でGitHub Secretへ直接登録します。

## 3. GitHub Secrets

リポジトリの Settings > Secrets and variables > Actions に次を登録します。

| 種別 | 名前 | 用途 |
|---|---|---|
| Secret | `GEMINI_API_KEY` | Gemini APIで調査・原稿生成 |
| Secret | `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Google Sheetsのサービスアカウント |
| Secret | `GOOGLE_WORKFLOW_SPREADSHEET_ID` | スプレッドシートURLの `/d/` と `/edit` の間の値 |
| Secret | `SUPABASE_URL` | SupabaseプロジェクトURL |
| Secret | `SUPABASE_READ_KEY` | 既存値の取得専用。publishable/anon keyを使用（ローカルでは既存の `SUPABASE_ANON_KEY` も利用可） |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | 承認済み行の公開専用 |

`SUPABASE_SERVICE_ROLE_KEY` は公開ジョブのステップだけに渡されます。Google SheetやGemini APIには渡りません。

## 4. GitHub Variables

| 名前 | 推奨初期値 | 用途 |
|---|---|---|
| `GOOGLE_WORKFLOW_SHEET_NAME` | `IMDB_PROFILE_WORKFLOW` | 操作対象タブ |
| `GOOGLE_MASTER_SHEET_NAME` | `MASTER_test` | 承認後の転記先となる正本タブ |
| `GEMINI_MODEL` | `gemini-3.8-flash` | 調査と構造化出力に使うモデル |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.6-flash` | 429・503・タイムアウト時に切り替える予備モデル |
| `IMDB_PROFILE_PUBLISH_ENABLED` | `false` | `true` のときだけSupabase公開ジョブを有効化 |

最初の精度検証中は `IMDB_PROFILE_PUBLISH_ENABLED=false` のままにします。

`GEMINI_API_KEY` はGoogle AI Studioで作成します。CursorとGitHubの連携やCursor APIキーは不要です。無料枠はモデルや検索機能の利用上限があるため、最初は1行ずつ検証します。

## 5. シートの初期化

GitHub Actionsの `IMDB profile workflow` を開き、`Run workflow` で `mode=setup` を実行します。タブとヘッダー、ステータスのプルダウンが作成されます。

ローカルで初期化する場合は、環境変数を設定して次を実行します。

```bash
npm run profile:sheet:setup
```

## 6. 原稿を生成する

シートへ新しい行を追加します。

| 列 | 入力内容 |
|---|---|
| `group_name` | 必須。例: `Tri-Sphere` |
| `group_slug` | 新規登録では任意。更新では通常空欄で可 |
| `request_type` | 必須。新規登録は `create`、更新は `update` |
| `status` | `queued` |

30分ごとの定期実行、または `mode=generate` の手動実行で処理されます。

- `create`: slugを入力した場合は、MASTERとDBの両方で未使用のときだけ生成します。空欄の場合はGeminiの提案slugを検査し、使用済みなら `-2`、`-3` のような未使用slugへ自動調整します。同名の既存グループがある場合は、重複登録を防ぐため停止します。
- `update`: slugが空欄なら `group_name` の完全一致でMASTERとDBを検索し、一意に特定できたslugを自動入力します。0件または複数候補の場合だけ、slugの確認が必要です。

成功すると `status=review` になり、次の情報が行へ入ります。

- `profile_ja`: DBへ登録する編集可能な本文。`概要` と `音楽性` の見出し付きで生成されます
- `overview_ja` / `musical_style_ja`: 生成時の内訳
- メンバー、活動拠点、所属、活動開始月
- 公式サイト・SNS・配信サービスURL・公式カレンダー・TicketDiveアーティストページ
- `sources_json`: 出典一覧
- `field_evidence_json`: 項目と根拠URLの対応
- 信頼度、注意事項、既存DB値、GeminiリクエストID

生成失敗時は `generation_error` と `last_error` を確認し、修正後に `queued` へ戻します。

カレンダーとTicketDiveは、Geminiの検索結果、既存DB値、公式ページ内のリンク・iframeから候補を集め、実在性と対象グループとの対応を機械検証します。確認できない場合は空欄にし、`warnings_json` に `calendar_url:` または `ticketdive_url:` で始まる理由を残します。

`members_ja` は生成時、MASTER転記時、DB公開時に全角スラッシュ（`／`）区切りへ統一します。Spotifyは `IMDB_PROFILE_WORKFLOW.spotify_url` に確認用のアーティストURLを保持し、`MASTER_test.spotifyId` とDBの `external_ids.external_id` にはArtist IDだけを保存します。DBのSpotify `url` は保存しません。

Spotify Artist URLは必須確認項目です。取得できない場合でもレビュー行は作成しますが、`warnings_json` に `spotify_url:` から始まる警告、`identity_notes` と `review_note` に `【要対応】Spotify Artist URL未取得。` を記録し、公開前の補完が必要なことを明示します。

## 7. 確認して公開する

1. `profile_ja` と各項目を直接修正します。
2. `sources_json` と `field_evidence_json` で根拠を確認します。
3. `group_slug` が正しい既存グループを指すか確認します。このslugをキーに `MASTER_test` の行が更新または追加されます。
4. `status` を `approved` にします。

公開機能を有効にする前は、ローカルでプレビューできます。

```bash
npm run profile:publish
```

実際にDBへ反映する明示指定は次のとおりです。

```bash
npm run profile:publish -- --apply
```

GitHub Actionsで1行だけ手動公開する場合は、`mode=publish` と対象行の `request_id` を指定します。この手動公開は `IMDB_PROFILE_PUBLISH_ENABLED=false` のままでも実行できます。対象をrequest_idで限定するため、別の承認済み行を誤って同時公開しません。

定期的な自動公開は、5〜10組の検証後にRepository Variable `IMDB_PROFILE_PUBLISH_ENABLED` を `true` にします。承認済み行は `MASTER_test` へ転記され、DBへの登録内容を読み戻して一致を確認した後に `published` になります。MASTERに必要な管理列がない場合は、既存列を保持したまま末尾へ追加します。既存行の任意項目は、承認用シートが空欄の場合に削除しません。

## 8. ステータス一覧

| status | 意味 |
|---|---|
| `queued` | 生成待ち |
| `generating` | Geminiが処理中 |
| `review` | 人による確認待ち |
| `approved` | MASTER転記とDB公開を承認済み |
| `publishing` | MASTER転記・DB更新中 |
| `published` | MASTER転記・DB更新完了 |
| `generation_error` | 生成・検証失敗 |
| `publish_error` | MASTER転記またはDB更新失敗 |

## 9. 精度検証

最初はTri-Sphereを含む性質の異なる5〜10組で、同一性、事実、出典、文章の粒度、未確認値の扱いを確認します。調査・執筆ルールは [`prompts/imdb_profile_research.md`](../prompts/imdb_profile_research.md) でバージョン管理します。
