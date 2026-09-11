---
name: imdb-profile
description: Codex自身が女性アイドルグループをWeb調査し、日本語プロフィールと公式URLを生成してIMDB_PROFILE_WORKFLOWへreview状態で登録する。ユーザーが「◯◯というアイドルグループのプロフィールを作って」、プロフィール作成、グループ情報の追加・更新、IMDBへの登録を依頼したときに使用する。
---

# IMDBプロフィールをCodexで作成する

この経路ではGemini APIを呼ばない。`profile:generate` を実行せず、`queued` 行も作らない。Codex自身がWeb検索、執筆、URL確認を行い、検証済みの完成稿を `IMDB_PROFILE_WORKFLOW` へ `review` で直接登録する。

## 固定対象

- Spreadsheet ID: `1BuiEr-pN5hS7jXoVCRuAMygInjzM7gHPY4uGGQIyXjw`
- 正本: `MASTER_test`
- 確認用: `IMDB_PROFILE_WORKFLOW`
- 生成仕様: `prompts/imdb_profile_research.md`

## 手順

1. `prompts/imdb_profile_research.md` を最後まで読む。
2. 接続済みのGoogle Drive/Sheets機能でスプレッドシートのメタデータ、両タブのヘッダー、書き込み候補行を読む。未接続なら接続を依頼して停止する。Geminiへフォールバックしない。
3. `MASTER_test.nameJapanese` をグループ名の完全一致（NFKC・大文字小文字を無視）で検索する。
   - 1件: `update`。その行の `slug` を必ず再利用し、既存行全体を `current_data` に入れる。
   - 0件: `create`。ASCII小文字のslugを提案し、`MASTER_test.slug` と照合する。使用済みなら `-2`、`-3` の順で未使用値を選ぶ。
   - 複数件: 対象を一意にできないため、slugをユーザーへ確認して停止する。
4. `IMDB_PROFILE_WORKFLOW` で同じグループまたはslugの `queued`、`generating`、`review`、`approved`、`publishing` 行を検索する。該当行があれば重複行を作らず、既存行と状態を報告する。
5. CodexのWeb検索を使って対象を調査する。公式サイト・公式SNS・運営・公式配信ページなど一次情報を優先し、検索結果の抜粋だけを根拠にしない。リンク先本文を確認する。
6. 生成仕様どおりの `research` JSONを作る。特に次を守る。
   - 同名グループを混同しない。
   - `overview_ja` と `musical_style_ja` は本文だけを返す。`profile_ja` への変換時に、それぞれの冒頭へ `概要` と `音楽性` の見出しが自動で付く。
   - `members_ja` は `／` 区切り。
   - Spotifyは必須確認項目。`https://open.spotify.com/artist/<Artist ID>` の完全URLを取得する。アルバム・楽曲・検索ページは使わない。
   - Spotify Artist URLを確認できない場合はnullにし、`warnings` に `spotify_url:` から始まる理由、`identity_notes` の冒頭に `【要対応】Spotify Artist URL未取得。` を記載する。レビュー行の `review_note` にも自動で要対応アラートが入る。
   - calendar/TicketDiveを確認できなければnullにし、`warnings` にそれぞれ `calendar_url:`、`ticketdive_url:` から始まる理由を書く。
   - `sources` は確認した直接URLを2件以上含め、`field_evidence` のURLをすべて `sources` にも含める。
7. 次の包み形式で `.codex-tmp/profile-result.json` を作成する。

```json
{
  "group_name": "依頼時のグループ名",
  "group_slug": "確定済みslug",
  "request_type": "create または update",
  "current_data": null,
  "research": {}
}
```

8. `npm run profile:codex:validate -- --input=.codex-tmp/profile-result.json` を実行する。失敗したら調査結果を修正し、成功するまで再検証する。出力の `ordered_values` は確認用タブの35列（A:AI）と同じ順序である。
9. 書き込み直前に、確認用タブの次の空行A:AIをセル情報付きで再読込し、空行であることと入力規則を確認する。
10. Google Sheetsの `updateCells` 相当の一括更新で、その行A:AIへ `ordered_values` を書く。更新フィールドは値だけに限定し、書式と入力規則を保持する。
11. 書いたA:AIを再読込し、少なくとも `request_id`、`status=review`、`group_name`、`group_slug`、`request_type`、`model=codex-chat` が一致することを検証する。
12. 一時JSONは削除する。ユーザーへ確認用タブの行番号、create/update、slug、未確認項目を報告し、内容確認後に `status` を `approved` へ変えるよう案内する。

## 禁止事項

- Gemini API、Gemini CLI、`profile:generate` を呼ばない。
- `status=approved` または `published` をCodexの判断だけで設定しない。
- この依頼だけを根拠にMASTERやDBへ直接書かない。
- 出典のない値を推測で補完しない。
- 既存の確認待ち行を黙って上書きしない。

## 依頼例

「◯◯というアイドルグループのプロフィールを作って」

この依頼では、調査から確認用行の作成まで実行し、ユーザーの承認操作を待つ。
