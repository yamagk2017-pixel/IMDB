# Schema Assets

Use this directory to describe the IMDB domain outside of generated migrations.

Suggested files:
- `tables.sql` – canonical definitions for idols, groups, memberships, activities, social links, tags, etc.
- `policies.sql` – row-level security, roles, and helper functions that enforce read-only access for client apps.
- `views.sql` – convenience views for analytics or aggregated lookups.
- `docs.md` – ERD notes, data dictionary, or onboarding references.

Keeping hand-crafted SQL here makes reviews easier, while `supabase/migrations` carries the actual applied change history.

# slug のルール（imd.groups.slug）

IMDB における slug は、グループを一意に識別するための ID 兼 URL 用文字列。

## 文字種ルール

- 使用できる文字は **英字（小文字 a–z）＋数字 0–9＋ハイフン（-）のみ**
- 大文字は使用しない（`RAY` → `ray` に正規化）
- 日本語・記号（_ や ! など）・スペースは使用しない

正規表現で表すと：

- `^[a-z0-9-]+$`

## 命名方針

- 基本はグループ名のローマ字 or 既存英語表記をベースにする
  - 例）`RAY` → `ray`
  - 例）`Ringwanderung` → `ringwanderung`
  - 例）`mirror, mirror` → `mirror-mirror`
- 同名グループが存在する場合のみ末尾に数字を付与する
  - 例）`ray-2`, `ray-3`

## 運用ルール

- slug は一度決めたら原則変更しない（URL・参照キーとして利用するため）
- IHC / バズッタラ / AIJ の内部参照や URL 生成には、この slug を用いる
