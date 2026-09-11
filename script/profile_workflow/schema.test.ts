import assert from "node:assert/strict";
import test from "node:test";
import {
  externalIdentityForDatabase,
  previewPublish,
} from "./database.js";
import {
  composeProfileJa,
  extractSpotifyArtistId,
  normalizeMonthForDatabase,
  normalizeMembersJa,
  parseResearchJson,
  parseWorkflowRequestType,
} from "./schema.js";
import { masterValuesFromWorkflow } from "./sheets.js";

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
    calendar_url: "https://calendar.google.com/calendar/embed?src=example",
    ticketdive_url: "https://ticketdive.com/artist/example",
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
    {
      url: "https://calendar.google.com/calendar/embed?src=example",
      title: "公式カレンダー",
      publisher: "テストグループ",
      accessed_at: "2026-09-10",
      source_type: "platform",
      supports: ["external_links.calendar_url"],
    },
    {
      url: "https://ticketdive.com/artist/example",
      title: "テストグループ TicketDive",
      publisher: "TicketDive",
      accessed_at: "2026-09-10",
      source_type: "platform",
      supports: ["external_links.ticketdive_url"],
    },
  ],
  field_evidence: {
    overview_ja: ["https://example.com/"],
    musical_style_ja: ["https://example.com/music"],
    "external_links.calendar_url": [
      "https://calendar.google.com/calendar/embed?src=example",
    ],
    "external_links.ticketdive_url": [
      "https://ticketdive.com/artist/example",
    ],
  },
  confidence: { identity: 0.95, profile: 0.9, attributes: 0.85 },
  warnings: [],
};

test("コードフェンス付きJSONを検証して読み込める", () => {
  const parsed = parseResearchJson(`\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``);
  assert.equal(parsed.suggested_slug, "test-group");
  assert.equal(
    composeProfileJa(parsed),
    `概要\n${validResult.overview_ja}\n\n音楽性\n${validResult.musical_style_ja}`,
  );
});

test("sourcesにない根拠URLを拒否する", () => {
  const invalid = structuredClone(validResult);
  invalid.field_evidence.overview_ja = ["https://invalid.example.com/"];
  assert.throws(() => parseResearchJson(JSON.stringify(invalid)), /sources に存在しないURL/);
});

test("二次情報のトップページURLを拒否する", () => {
  const invalid = structuredClone(validResult);
  invalid.sources[1] = {
    ...invalid.sources[1],
    url: "https://media.example.com/",
    source_type: "secondary",
  };
  invalid.field_evidence.musical_style_ja = ["https://media.example.com/"];
  assert.throws(
    () => parseResearchJson(JSON.stringify(invalid)),
    /個別記事のURLが必要/,
  );
});

test("活動開始月をDBの日付へ正規化する", () => {
  assert.equal(normalizeMonthForDatabase("2024-05"), "2024-05-01");
  assert.throws(() => normalizeMonthForDatabase("2024"));
});

test("新規登録と更新の指定を必須にする", () => {
  assert.equal(parseWorkflowRequestType("create"), "create");
  assert.equal(parseWorkflowRequestType(" UPDATE "), "update");
  assert.throws(() => parseWorkflowRequestType(""), /create または update/);
  assert.throws(() => parseWorkflowRequestType("auto"), /create または update/);
});

test("メンバー名を全角スラッシュ区切りへ正規化する", () => {
  assert.equal(
    normalizeMembersJa("山田花子、佐藤春子, 鈴木夏子／高橋秋子/田中冬子"),
    "山田花子／佐藤春子／鈴木夏子／高橋秋子／田中冬子",
  );
  assert.equal(normalizeMembersJa(null), null);
});

test("SpotifyはArtist IDだけをDBへ保存する", () => {
  const id = "0zdhw79y1w1sfDTKUlJhyz";
  const url = `https://open.spotify.com/artist/${id}?si=test`;
  assert.equal(extractSpotifyArtistId(url), id);
  assert.equal(extractSpotifyArtistId(id), id);
  assert.equal(
    extractSpotifyArtistId("https://open.spotify.com/track/not-an-artist"),
    null,
  );
  assert.deepEqual(externalIdentityForDatabase("spotify", url), {
    external_id: id,
    url: null,
  });

  const values = {
    request_type: "create",
    group_name: validResult.canonical_name_ja,
    group_slug: validResult.suggested_slug,
    profile_ja: `${validResult.overview_ja}\n\n${validResult.musical_style_ja}`,
    sources_json: JSON.stringify(validResult.sources),
    field_evidence_json: JSON.stringify(validResult.field_evidence),
    spotify_url: id,
  };
  assert.ok(previewPublish(values).fields.includes("spotify_url"));
});

test("MASTER転記用にSpotify IDと日本語プロフィールを正規化する", () => {
  const id = "0zdhw79y1w1sfDTKUlJhyz";
  const values = masterValuesFromWorkflow({
    group_slug: "test-group",
    group_name: "テストグループ",
    profile_ja: "テスト用プロフィール",
    members_ja: "山田花子、佐藤春子",
    location_ja: "東京都内",
    agency_ja: "テスト事務所",
    activity_started_month: "2024-05",
    activity_started_basis: "debut",
    spotify_url: `https://open.spotify.com/artist/${id}?si=test`,
    website_url: "https://example.com/",
    x_url: "https://x.com/test_group",
    instagram_url: "https://instagram.com/test_group",
    tiktok_url: "https://tiktok.com/@test_group",
    youtube_url: "https://youtube.com/@test_group",
    calendar_url: "https://example.com/schedule",
    ticketdive_url: "https://ticketdive.com/artist/test-group",
  });

  assert.deepEqual(values, {
    slug: "test-group",
    nameJapanese: "テストグループ",
    profileJa: "テスト用プロフィール",
    membersJa: "山田花子／佐藤春子",
    spotifyId: id,
    activityStartedMonth: "2024-05",
    activityStartedBasis: "debut",
    locationJa: "東京都内",
    agencyJa: "テスト事務所",
    websiteLink: "https://example.com/",
    xLink: "https://x.com/test_group",
    instagramLink: "https://instagram.com/test_group",
    tiktokLink: "https://tiktok.com/@test_group",
    youtubeLink: "https://youtube.com/@test_group",
    calendarLink: "https://example.com/schedule",
    ticketdiveLink: "https://ticketdive.com/artist/test-group",
  });
});

test("MASTER転記で空の任意項目は既存値の削除対象にしない", () => {
  const values = masterValuesFromWorkflow({
    group_slug: "test-group",
    group_name: "テストグループ",
    profile_ja: "テスト用プロフィール",
    website_url: "",
    members_ja: "",
  });
  assert.equal("websiteLink" in values, false);
  assert.equal("membersJa" in values, false);
});

test("TicketDiveの個別公演URLを拒否する", () => {
  const invalid = structuredClone(validResult);
  invalid.external_links.ticketdive_url = "https://ticketdive.com/event/example";
  assert.throws(
    () => parseResearchJson(JSON.stringify(invalid)),
    /アーティストページURL/,
  );
});

test("公開前にプロフィールと根拠の対応を検証する", () => {
  const values = {
    request_type: "create",
    group_name: validResult.canonical_name_ja,
    group_slug: validResult.suggested_slug,
    profile_ja: `${validResult.overview_ja}\n\n${validResult.musical_style_ja}`,
    sources_json: JSON.stringify(validResult.sources),
    field_evidence_json: JSON.stringify(validResult.field_evidence),
    calendar_url: validResult.external_links.calendar_url,
    ticketdive_url: validResult.external_links.ticketdive_url,
  };
  const preview = previewPublish(values);
  assert.equal(preview.slug, "test-group");
  assert.ok(preview.fields.includes("calendar_url"));
  assert.ok(preview.fields.includes("ticketdive_url"));

  assert.throws(
    () => previewPublish({ ...values, field_evidence_json: "{}" }),
    /overview_ja に根拠URL/,
  );
});
