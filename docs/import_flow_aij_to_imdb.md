# AIJ → IMDB インポートフロー（v0）

このドキュメントは、AIJ（ALT-IDOL JAPAN）のグループ一覧データを IMDB（アイドルマスタDB）へ取り込むための手順とルールをまとめたものです。

---

## 1. データフロー全体像

```
AIJ本番シート（変更不可）
        ↓ コピー
MASTERシート（IMDB用に整形）
        ↓ CSVエクスポート
data/MASTER_xxx.csv
        ↓ import_master.ts
Supabase（imd.groups / imd.external_ids / imd.group_profiles）
```

---

## 2. MASTER シートの役割

AIJの本番シートは別アプリが参照しているため列追加不可。IMDBに必要な追加情報（slug など）は **MASTER シート** にのみ持たせる。

### MASTER に追加する主な列

* `slug`（必須）
* `importFlag`（任意）
* `notes`（任意）
* `profileJa`（任意・長文OK）
* `profileEn`（任意・長文OK）
* `membersJa` / `membersEn`（任意）
* `locationJa` / `locationEn`（任意）
* `agencyJa` / `agencyEn`（任意）

slug のルール：

* 英字（小文字）＋数字＋ハイフンのみ
* 正規表現：`^[a-z0-9-]+$`

---

## 3. AIJ → IMDB マッピング（要点）

### 3.1 groups

| MASTER列      | IMDB列              | 備考            |
| ------------ | ------------------ | ------------- |
| nameJapanese | imd.groups.name_ja | 必須            |
| slug         | imd.groups.slug    | 小文字/数字/ハイフンのみ |
| nameEnglish  | *将来追加*             |               |
| nameReading  | *将来追加*             |               |
| locationJa   | imd.group_attributes (location/ja) |               |
| locationEn   | imd.group_attributes (location/en) |               |
| agencyJa     | imd.group_attributes (agency/ja)   |               |
| agencyEn     | imd.group_attributes (agency/en)   |               |
| profileJa    | imd.group_profiles (ja) | 長文OK          |
| profileEn    | imd.group_profiles (en) | 長文OK          |
| membersJa    | imd.group_attributes (members/ja)  |               |
| membersEn    | imd.group_attributes (members/en)  |               |

### 3.2 external_ids

| MASTER列       | service         | external_id        | url         |
| ------------- | --------------- | ------------------ | ----------- |
| spotifyId     | spotify         | Artist ID          | URL生成 or 保存 |
| youtubeLink   | youtube_channel | Channel ID or null | 元URL        |
| websiteLink   | website         | null               | 元URL        |
| xLink         | x               | handle             | 元URL        |
| instagramLink | instagram       | handle             | 元URL        |
| tiktokLink    | tiktok          | handle             | 元URL        |
| calendarLink  | google_calendar | ID or null         | 元URL        |

---

## 4. インポート手順（実作業）

### STEP 1：MASTER シートで slug を埋める

* 最初は 5〜10 グループだけでOK

### STEP 2：MASTER を CSV エクスポート

* ファイル名例：`MASTER_profile.csv`
* IMDB レポジトリの `data/` ディレクトリへ保存

### STEP 3：import_master.ts を実行

* CSVを読み取り、各行を `imd.groups` / `imd.external_ids` / `imd.group_profiles` / `imd.group_attributes` に upsert
* 1〜数件の更新だけ行いたい場合は `importFlag` を使う
  * `importFlag` が空・`0` 以外の行だけ取り込み対象
  * 実行例：`IMPORT_FLAG_ONLY=1 npx tsx script/import_master.ts`

### STEP 4：Supabase 上で確認

* `groups` / `external_ids` / `group_profiles` / `group_attributes` の内容を目視で確認

### STEP 5：問題なければ600行のフルCSVで実行

---

## 5. エラーチェック / 運用ルール

* slug が空の行はスキップ（import対象外）
* slug の重複は MASTER 側で解消しておく
* external_id と url は null 許容（欠損OK）
* 同じ (group_id, service) は upsert（上書き）

---

## 6. 将来拡張

* group_profiles に履歴/公開状態などの拡張
* group_attributes の key/locale 拡張
* 事務所テーブル（imd.agencies）追加
* メンバーテーブル（imd.members）追加
* import_master.ts を差分更新対応にアップグレード

---

以上が、AIJ → IMDB インポートの基礎フローです。
