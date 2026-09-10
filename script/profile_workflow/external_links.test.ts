import assert from "node:assert/strict";
import test from "node:test";
import { resolveResearchExternalLinks } from "./external_links.js";
import type { ResearchResult } from "./schema.js";

function fixture(): ResearchResult {
  return {
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
      x_url: null,
      instagram_url: null,
      tiktok_url: null,
      youtube_url: null,
      spotify_url: null,
      calendar_url: null,
      ticketdive_url: null,
    },
    sources: [
      {
        url: "https://example.com/",
        title: "公式サイト",
        publisher: "テストグループ",
        accessed_at: "2026-09-11",
        source_type: "official",
        supports: ["overview_ja"],
      },
      {
        url: "https://example.com/music",
        title: "楽曲紹介",
        publisher: "テストグループ",
        accessed_at: "2026-09-11",
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
}

function fetchMock(routes: Record<string, { status?: number; body?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes[url] ?? { status: 404 };
    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
}

test("公式ページのリンクとiframeからカレンダーとTicketDiveを抽出する", async () => {
  const result = await resolveResearchExternalLinks({
    result: fixture(),
    requestedName: "テストグループ",
    fetchImpl: fetchMock({
      "https://example.com/": {
        body: `
          <a href="/schedule">Schedule</a>
          <iframe src="https://calendar.google.com/calendar/embed?src=test&amp;ctz=Asia%2FTokyo"></iframe>
          <a href="https://ticketdive.com/artist/AbCdEf123">TicketDive</a>
        `,
      },
      "https://ticketdive.com/artist/AbCdEf123": {
        body: "<title>テストグループ | TicketDive</title>",
      },
    }),
  });

  assert.equal(
    result.external_links.calendar_url,
    "https://calendar.google.com/calendar/embed?src=test&ctz=Asia%2FTokyo",
  );
  assert.equal(
    result.external_links.ticketdive_url,
    "https://ticketdive.com/artist/AbCdEf123",
  );
  assert.deepEqual(result.field_evidence["external_links.calendar_url"], [
    "https://example.com/",
  ]);
  assert.deepEqual(result.field_evidence["external_links.ticketdive_url"], [
    "https://example.com/",
  ]);
});

test("実在しない候補は削除し、抽出漏れを定型警告に残す", async () => {
  const input = fixture();
  const invalidUrl = "https://ticketdive.com/artist/test-group";
  input.external_links.ticketdive_url = invalidUrl;
  input.sources.push({
    url: invalidUrl,
    title: "テストグループ TicketDive",
    publisher: "TicketDive",
    accessed_at: "2026-09-11",
    source_type: "platform",
    supports: ["external_links.ticketdive_url"],
  });
  input.field_evidence["external_links.ticketdive_url"] = [invalidUrl];

  const result = await resolveResearchExternalLinks({
    result: input,
    requestedName: "テストグループ",
    fetchImpl: fetchMock({
      "https://example.com/": { body: "<html></html>" },
      [invalidUrl]: { status: 404 },
    }),
  });

  assert.equal(result.external_links.calendar_url, null);
  assert.equal(result.external_links.ticketdive_url, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith("calendar_url:")));
  assert.ok(result.warnings.some((warning) => warning.startsWith("ticketdive_url:")));
  assert.ok(!result.sources.some((source) => source.url === invalidUrl));
});
