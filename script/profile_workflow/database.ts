import { createClient } from "@supabase/supabase-js";
import {
  normalizeMonthForDatabase,
  optionalCell,
  sourceSchema,
  type WorkflowValues,
} from "./schema.js";

export type ExistingGroupContext = {
  group: {
    id: string;
    name_ja: string;
    slug: string;
    status: string;
    activity_started_month: string | null;
    activity_started_basis: string;
  };
  profile_ja: string | null;
  attributes_ja: Record<string, string>;
  external_links: Record<string, string>;
};

function createImdClient(key: string) {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) throw new Error("SUPABASE_URL が設定されていません");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "imd" },
  });
}

export async function loadExistingGroup(
  slug: string | undefined,
  groupName: string,
): Promise<ExistingGroupContext | null> {
  const readKey =
    process.env.SUPABASE_READ_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!readKey || !process.env.SUPABASE_URL?.trim()) return null;

  const supabase = createImdClient(readKey);
  let query = supabase
    .from("groups")
    .select(
      "id,name_ja,slug,status,activity_started_month,activity_started_basis",
    );
  query = slug?.trim()
    ? query.eq("slug", slug.trim()).limit(2)
    : query.eq("name_ja", groupName).limit(2);

  const { data: groups, error: groupError } = await query;
  if (groupError) throw new Error(`既存グループの取得に失敗しました: ${groupError.message}`);
  if (!groups || groups.length !== 1) return null;

  const group = groups[0] as ExistingGroupContext["group"];
  const [profileResult, attributesResult, externalsResult] = await Promise.all([
    supabase
      .from("group_profiles")
      .select("body")
      .eq("group_id", group.id)
      .eq("locale", "ja")
      .maybeSingle(),
    supabase
      .from("group_attributes")
      .select("key,value")
      .eq("group_id", group.id)
      .eq("locale", "ja"),
    supabase
      .from("external_ids")
      .select("service,url")
      .eq("group_id", group.id),
  ]);

  for (const result of [profileResult, attributesResult, externalsResult]) {
    if (result.error) {
      throw new Error(`既存データの取得に失敗しました: ${result.error.message}`);
    }
  }

  return {
    group,
    profile_ja: (profileResult.data as { body?: string } | null)?.body ?? null,
    attributes_ja: Object.fromEntries(
      ((attributesResult.data ?? []) as Array<{ key: string; value: string }>).map(
        ({ key, value }) => [key, value],
      ),
    ),
    external_links: Object.fromEntries(
      ((externalsResult.data ?? []) as Array<{ service: string; url: string | null }>)
        .filter((item) => item.url)
        .map(({ service, url }) => [service, url!]),
    ),
  };
}

function extractExternalId(service: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (service === "spotify") {
      const artistIndex = parts.indexOf("artist");
      return artistIndex >= 0 ? parts[artistIndex + 1] ?? null : parts.at(-1) ?? null;
    }
    if (["x", "instagram", "tiktok"].includes(service)) {
      return parts[0]?.replace(/^@/, "") ?? null;
    }
    if (service === "ticketdive") {
      const artistIndex = parts.findIndex(
        (part) => part.toLowerCase() === "artist",
      );
      return artistIndex >= 0
        ? parts[artistIndex + 1] ?? null
        : parts.at(-1) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function validateEvidence(values: WorkflowValues): void {
  const rawSources = optionalCell(values.sources_json);
  const rawFieldEvidence = optionalCell(values.field_evidence_json);
  if (!rawSources) throw new Error("sources_json が空です");
  if (!rawFieldEvidence) throw new Error("field_evidence_json が空です");
  let parsedSources: unknown;
  let parsedFieldEvidence: unknown;
  try {
    parsedSources = JSON.parse(rawSources);
    parsedFieldEvidence = JSON.parse(rawFieldEvidence);
  } catch (error) {
    throw new Error("sources_json または field_evidence_json が正しいJSONではありません", {
      cause: error,
    });
  }
  const sources = sourceSchema.array().min(2).parse(parsedSources);
  if (new Set(sources.map((source) => source.url)).size < 2) {
    throw new Error("公開には異なる出典URLが2件以上必要です");
  }
  const fieldEvidence = parsedFieldEvidence as Record<string, unknown>;
  if (
    !fieldEvidence ||
    typeof fieldEvidence !== "object" ||
    Array.isArray(fieldEvidence)
  ) {
    throw new Error("field_evidence_json はオブジェクトにしてください");
  }
  const sourceUrls = new Set(sources.map((source) => source.url));
  for (const [field, urls] of Object.entries(fieldEvidence)) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error(`field_evidence_json.${field} は空ではないURL配列にしてください`);
    }
    for (const url of urls) {
      if (typeof url !== "string" || !sourceUrls.has(url)) {
        throw new Error(`${field} の根拠URLが sources_json に存在しません: ${String(url)}`);
      }
    }
  }
  for (const requiredField of ["overview_ja", "musical_style_ja"]) {
    const urls = fieldEvidence[requiredField];
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error(`field_evidence_json.${requiredField} に根拠URLが必要です`);
    }
  }
}

export type PublishPreview = {
  slug: string;
  groupName: string;
  fields: string[];
};

export function previewPublish(values: WorkflowValues): PublishPreview {
  const slug = optionalCell(values.group_slug);
  const groupName = optionalCell(values.group_name);
  const profile = optionalCell(values.profile_ja);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("group_slug が空、または形式が不正です");
  }
  if (!groupName) throw new Error("group_name が空です");
  if (!profile || profile.length < 100) {
    throw new Error("profile_ja は100文字以上必要です");
  }
  if (/(?:cite|turn\d+(?:search|view)|view\d+)/i.test(profile)) {
    throw new Error("profile_ja に内部引用記号が残っています");
  }
  const basis = optionalCell(values.activity_started_basis);
  if (
    basis &&
    !["formation", "debut", "first_show", "relaunch", "unknown"].includes(basis)
  ) {
    throw new Error(`activity_started_basis が許容値ではありません: ${basis}`);
  }
  for (const field of [
    "website_url",
    "x_url",
    "instagram_url",
    "tiktok_url",
    "youtube_url",
    "spotify_url",
    "calendar_url",
    "ticketdive_url",
  ] as const) {
    const url = optionalCell(values[field]);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error(`${field} が正しいHTTP(S) URLではありません: ${url}`);
    }
  }
  validateEvidence(values);

  const fields = ["groups.name_ja", "group_profiles.ja"];
  for (const field of [
    "members_ja",
    "location_ja",
    "agency_ja",
    "activity_started_month",
    "website_url",
    "x_url",
    "instagram_url",
    "tiktok_url",
    "youtube_url",
    "spotify_url",
    "calendar_url",
    "ticketdive_url",
  ] as const) {
    if (optionalCell(values[field])) fields.push(field);
  }
  return { slug, groupName, fields };
}

export async function publishApprovedRow(values: WorkflowValues): Promise<PublishPreview> {
  const preview = previewPublish(values);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  const supabase = createImdClient(serviceKey);
  const now = new Date().toISOString();

  const groupPayload: Record<string, string> = {
    slug: preview.slug,
    name_ja: preview.groupName,
    updated_at: now,
  };
  const month = optionalCell(values.activity_started_month);
  if (month) {
    groupPayload.activity_started_month = normalizeMonthForDatabase(month);
    groupPayload.activity_started_basis =
      optionalCell(values.activity_started_basis) ?? "unknown";
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .upsert(groupPayload, { onConflict: "slug" })
    .select("id")
    .single();
  if (groupError || !group) {
    throw new Error(`groups の更新に失敗しました: ${groupError?.message ?? "unknown"}`);
  }
  const groupId = group.id as string;

  const profile = optionalCell(values.profile_ja)!;
  const { error: profileError } = await supabase.from("group_profiles").upsert(
    { group_id: groupId, locale: "ja", body: profile, updated_at: now },
    { onConflict: "group_id,locale" },
  );
  if (profileError) {
    throw new Error(`group_profiles の更新に失敗しました: ${profileError.message}`);
  }

  for (const [key, column] of [
    ["members", "members_ja"],
    ["location", "location_ja"],
    ["agency", "agency_ja"],
  ] as const) {
    const value = optionalCell(values[column]);
    if (!value) continue;
    const { error } = await supabase.from("group_attributes").upsert(
      { group_id: groupId, key, locale: "ja", value, updated_at: now },
      { onConflict: "group_id,key,locale" },
    );
    if (error) throw new Error(`group_attributes(${key}) の更新に失敗しました: ${error.message}`);
  }

  for (const [service, column] of [
    ["website", "website_url"],
    ["x", "x_url"],
    ["instagram", "instagram_url"],
    ["tiktok", "tiktok_url"],
    ["youtube_channel", "youtube_url"],
    ["spotify", "spotify_url"],
    ["schedule", "calendar_url"],
    ["ticketdive", "ticketdive_url"],
  ] as const) {
    const url = optionalCell(values[column]);
    if (!url) continue;
    const { error } = await supabase.from("external_ids").upsert(
      {
        group_id: groupId,
        service,
        external_id: extractExternalId(service, url),
        url,
      },
      { onConflict: "group_id,service" },
    );
    if (error) throw new Error(`external_ids(${service}) の更新に失敗しました: ${error.message}`);
  }

  return preview;
}
