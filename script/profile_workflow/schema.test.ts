import assert from "node:assert/strict";
import test from "node:test";
import { previewPublish } from "./database.js";
import {
  composeProfileJa,
  normalizeMonthForDatabase,
  parseResearchJson,
} from "./schema.js";

const validResult = {
  schema_version: "1.0",
  canonical_name_ja: "テストグループ",
  suggested_slug: "test-group",
  identity_confirmed: true,
  identity_notes: "公式サイトと公式SNSの相互リンクで確認した。",
  overview_ja:
    "テストグループは、2024年に活動を開始した女性アイドルグループ。公式発表に基づいて活動開始時期とグループのコンセプトを確認し、継続的にライブ活動を行っている。現在の体制についても公式サイトで案内されている。",
  musical_style_ja:
    "電子音を取り入れたダンスミュージックを軸とし、作品ごとにロックやポップスの要素を組み合わせている。公式の楽曲解説では、ライブ会場での一体感を意識した構成と歌唱表現が特徴として示されている。",
  attributes: {
    members_ja: "山田花子、佐藤春子",
    location_ja: "東京都内中心",
    agency_ja: "テスト事務所",
    activity_started_month: "2024-05",
    activity_started_basis: "debut",
  },
  external_links: {
    website_url: "https://example.com/",
    x_url: "https://x.com/example",
    instagram_url: null,
    tiktok_url: null,
    youtube_url: null,
    spotify_url: null,
  },
  sources: [
    {
      url: "https://example.com/",
      title: "公式サイト",
      publisher: "テストグループ",
      accessed_at: "2026-09-10",
      source_type: "official",
      supports: ["overview_ja", "attributes.members_ja"],
    },
    {
      url: "https://example.com/music",
      title: "楽曲紹介",
      publisher: "テストグループ",
      accessed_at: "2026-09-10",
      source_type: "primary",
      supports: ["musical_style_ja"],
    },
  ],
  field_evidence: {
    overview_ja: ["https://example.com/"],
    musical_style_ja: ["https://example.com/music"],
  },
  confidence: { identity: 0.95, profile: 0.9, attributes: 0.85 },
  warnings: [],
};

test("コードフェンス付きJSONを検証して読み込める", () => {
  const parsed = parseResearchJson(`\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``);
  assert.equal(parsed.suggested_slug, "test-group");
  assert.match(composeProfileJa(parsed), /\n\n/);
});

test("sourcesにない根拠URLを拒否する", () => {
  const invalid = structuredClone(validResult);
  invalid.field_evidence.overview_ja = ["https://invalid.example.com/"];
  assert.throws(() => parseResearchJson(JSON.stringify(invalid)), /sources に存在しないURL/);
});

test("活動開始月をDBの日付へ正規化する", () => {
  assert.equal(normalizeMonthForDatabase("2024-05"), "2024-05-01");
  assert.throws(() => normalizeMonthForDatabase("2024"));
});

test("公開前にプロフィールと根拠の対応を検証する", () => {
  const values = {
    group_name: validResult.canonical_name_ja,
    group_slug: validResult.suggested_slug,
    profile_ja: `${validResult.overview_ja}\n\n${validResult.musical_style_ja}`,
    sources_json: JSON.stringify(validResult.sources),
    field_evidence_json: JSON.stringify(validResult.field_evidence),
  };
  assert.equal(previewPublish(values).slug, "test-group");

  assert.throws(
    () => previewPublish({ ...values, field_evidence_json: "{}" }),
    /overview_ja に根拠URL/,
  );
});
