import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexWorkflowOutput } from "./codex.js";

const overview =
  "テストアイドルは、2024年4月に活動を開始した女性アイドルグループ。公式発表を基に、結成の経緯と現在までの活動を客観的にまとめたテスト用の概要文章である。初ライブ以降、都内を中心に定期公演や対バンへ出演し、作品発表も継続している。現在の体制についても公式サイトで確認している。";
const musicalStyle =
  "楽曲はエレクトロニックな音色とバンドサウンドを組み合わせ、明確なメロディと複数人の歌唱を軸に構成される。公開音源と公式の作品紹介では、ダンス曲と情感を重視した楽曲の両方が確認できる。ライブでは振付と観客との一体感を意識した表現を特徴としている。";

function validInput(): unknown {
  return {
    group_name: "テストアイドル",
    group_slug: "test-idol",
    request_type: "create",
    research: {
      schema_version: "1.0",
      canonical_name_ja: "テストアイドル",
      suggested_slug: "test-idol",
      identity_confirmed: true,
      identity_notes: "公式サイトと公式配信ページの相互リンクで確認",
      overview_ja: overview,
      musical_style_ja: musicalStyle,
      attributes: {
        members_ja: "山田花子、佐藤春",
        location_ja: "東京都内",
        agency_ja: null,
        activity_started_month: "2024-04",
        activity_started_basis: "debut",
      },
      external_links: {
        website_url: "https://example.com/profile",
        x_url: null,
        instagram_url: null,
        tiktok_url: null,
        youtube_url: null,
        spotify_url: "https://open.spotify.com/artist/0123456789ABCDEFGHIJKL",
        calendar_url: null,
        ticketdive_url: null,
      },
      sources: [
        {
          url: "https://example.com/profile",
          title: "公式プロフィール",
          publisher: "テストアイドル",
          accessed_at: "2026-09-11",
          source_type: "official",
          supports: ["overview_ja", "attributes.members_ja"],
        },
        {
          url: "https://open.spotify.com/artist/0123456789ABCDEFGHIJKL",
          title: "テストアイドル",
          publisher: "Spotify",
          accessed_at: "2026-09-11",
          source_type: "platform",
          supports: ["musical_style_ja", "external_links.spotify_url"],
        },
      ],
      field_evidence: {
        overview_ja: ["https://example.com/profile"],
        musical_style_ja: [
          "https://open.spotify.com/artist/0123456789ABCDEFGHIJKL",
        ],
      },
      confidence: { identity: 0.98, profile: 0.85, attributes: 0.8 },
      warnings: [
        "calendar_url: 公式カレンダーを確認できませんでした",
        "ticketdive_url: アーティストページを確認できませんでした",
      ],
    },
  };
}

test("Codex調査結果をreview行へ変換する", () => {
  const output = buildCodexWorkflowOutput(validInput(), {
    requestId: "11111111-1111-4111-8111-111111111111",
    now: new Date("2026-09-11T01:00:00.000Z"),
  });

  assert.equal(output.values.status, "review");
  assert.equal(output.values.model, "codex-chat");
  assert.equal(output.values.members_ja, "山田花子／佐藤春");
  assert.equal(output.values.group_slug, "test-idol");
  assert.equal(output.ordered_values.length, output.columns.length);
  assert.equal(output.columns.length, 35);
});

test("未確認URLのwarningがない結果を拒否する", () => {
  const input = validInput() as {
    research: { warnings: string[] };
  };
  input.research.warnings = [];
  assert.throws(
    () => buildCodexWorkflowOutput(input),
    /calendar_url を確認できなかった理由/,
  );
});

test("Spotifyのアーティストページ以外を拒否する", () => {
  const input = validInput() as {
    research: { external_links: { spotify_url: string } };
  };
  input.research.external_links.spotify_url =
    "https://open.spotify.com/track/0123456789ABCDEFGHIJKL";
  assert.throws(
    () => buildCodexWorkflowOutput(input),
    /Spotifyの公式アーティストページURL/,
  );
});
