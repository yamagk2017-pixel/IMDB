// scripts/import_master.ts
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

type MasterRow = {
  nameJapanese: string;
  nameEnglish?: string;
  nameReading?: string;
  members?: string;
  location?: string;
  agency?: string;
  membersJa?: string;
  membersEn?: string;
  locationJa?: string;
  locationEn?: string;
  agencyJa?: string;
  agencyEn?: string;
  profileJa?: string;
  profileEn?: string;
  youtubeLink?: string;
  spotifyId?: string;
  websiteLink?: string;
  xLink?: string;
  instagramLink?: string;
  tiktokLink?: string;
  calendarLink?: string;
  ticketdiveLink?: string;
  slug?: string;
  importFlag?: string;
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: "imd" },  // ← これ
  });  

// __dirname が未定義な ESM 実行に対応
const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CSV_PATH = path.resolve(currentDir, "../data/MASTER_profile.csv");
const CSV_PATH = process.env.CSV_PATH
  ? path.resolve(process.env.CSV_PATH)
  : DEFAULT_CSV_PATH;

function loadCsv(): MasterRow[] {
  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as MasterRow[];

  const onlyFlagged = process.env.IMPORT_FLAG_ONLY === "1";
  if (!onlyFlagged) return records;

  return records.filter((row) => {
    const flag = row.importFlag?.trim();
    return !!flag && flag !== "0";
  });
}

function normalizeSlug(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // slug ルール: 英小文字 + 数字 + ハイフン のみ
  if (!/^[a-z0-9-]+$/.test(s)) {
    console.warn(`slug がルール外のためスキップ: "${raw}"`);
    return null;
  }
  return s;
}

type ExternalRecord = {
  service: string;
  external_id: string | null;
  url: string | null;
};

type ProfileRecord = {
  locale: "ja" | "en";
  body: string;
};

type AttributeRecord = {
  key: "members" | "location" | "agency";
  locale: "ja" | "en";
  value: string;
};

type ExistingExternal = { service: string };
type ExistingProfile = { locale: "ja" | "en" };
type ExistingAttribute = { id: string; key: "members" | "location" | "agency"; locale: "ja" | "en" };

function extractSpotifyId(value: string): string {
  // URL が入っている場合は最後のセグメントを ID とみなす
  if (value.includes("open.spotify.com")) {
    const noQuery = value.split("?")[0];
    const parts = noQuery.split("/");
    return parts[parts.length - 1];
  }
  return value;
}

function extractHandleFromUrl(url: string): string | null {
  // https://x.com/handle のようなURLから handle 部分だけ抜き出す簡易版
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) {
      return parts[0].startsWith("@") ? parts[0].slice(1) : parts[0];
    }
    return null;
  } catch {
    // URL でなければそのまま返す（@handle など）
    return url.replace(/^@/, "") || null;
  }
}

function extractTicketdiveArtistId(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    const artistIdx = parts.findIndex((p) => p.toLowerCase() === "artist");

    if (artistIdx >= 0 && parts[artistIdx + 1]) {
      return parts[artistIdx + 1];
    }
    if (parts.length >= 1) {
      return parts[parts.length - 1];
    }
    return null;
  } catch {
    // URLでない場合はID/slugそのものとして扱う
    return raw.replace(/^@/, "") || null;
  }
}

function buildExternalRecords(row: MasterRow): ExternalRecord[] {
  const result: ExternalRecord[] = [];

  if (row.spotifyId) {
    result.push({
      service: "spotify",
      external_id: extractSpotifyId(row.spotifyId),
      url: row.spotifyId.includes("http")
        ? row.spotifyId
        : `https://open.spotify.com/artist/${extractSpotifyId(row.spotifyId)}`,
    });
  }

  if (row.youtubeLink) {
    result.push({
      service: "youtube_channel",
      external_id: null, // 必要ならチャンネルID抽出ロジックを追加
      url: row.youtubeLink,
    });
  }

  if (row.websiteLink) {
    result.push({
      service: "website",
      external_id: null,
      url: row.websiteLink,
    });
  }

  if (row.xLink) {
    result.push({
      service: "x",
      external_id: extractHandleFromUrl(row.xLink),
      url: row.xLink,
    });
  }

  if (row.instagramLink) {
    result.push({
      service: "instagram",
      external_id: extractHandleFromUrl(row.instagramLink),
      url: row.instagramLink,
    });
  }

  if (row.tiktokLink) {
    result.push({
      service: "tiktok",
      external_id: extractHandleFromUrl(row.tiktokLink),
      url: row.tiktokLink,
    });
  }

  if (row.calendarLink) {
    result.push({
      service: "schedule",
      external_id: null, // 必要なら ID 抽出ロジックを追加
      url: row.calendarLink,
    });
  }

  if (row.ticketdiveLink) {
    const ticketdiveId = extractTicketdiveArtistId(row.ticketdiveLink);
    result.push({
      service: "ticketdive",
      external_id: ticketdiveId,
      url: row.ticketdiveLink,
    });
  }

  return result;
}

function buildProfileRecords(row: MasterRow): ProfileRecord[] {
  const result: ProfileRecord[] = [];

  const profileJa = row.profileJa?.trim();
  if (profileJa) {
    result.push({ locale: "ja", body: profileJa });
  }

  const profileEn = row.profileEn?.trim();
  if (profileEn) {
    result.push({ locale: "en", body: profileEn });
  }

  return result;
}

function buildAttributeRecords(row: MasterRow): AttributeRecord[] {
  const result: AttributeRecord[] = [];

  const pushIf = (
    key: AttributeRecord["key"],
    locale: AttributeRecord["locale"],
    value?: string
  ) => {
    const v = value?.trim();
    if (v) result.push({ key, locale, value: v });
  };

  // Preferred locale-specific columns
  pushIf("members", "ja", row.membersJa);
  pushIf("members", "en", row.membersEn);
  pushIf("location", "ja", row.locationJa);
  pushIf("location", "en", row.locationEn);
  pushIf("agency", "ja", row.agencyJa);
  pushIf("agency", "en", row.agencyEn);

  // Backward compatibility: fall back to legacy columns (assumed English)
  if (!row.membersJa && !row.membersEn) {
    pushIf("members", "en", row.members);
  }
  if (!row.locationJa && !row.locationEn) {
    pushIf("location", "en", row.location);
  }
  if (!row.agencyJa && !row.agencyEn) {
    pushIf("agency", "en", row.agency);
  }

  return result;
}

function hasNonEmptyCsvRows(rows: MasterRow[]): boolean {
  return rows.some((row) => {
    const slug = normalizeSlug(row.slug);
    return !!slug && !!row.nameJapanese?.trim();
  });
}

async function deactivateMissingGroups(
  activeCsvSlugs: Set<string>,
  runAtIso: string
): Promise<void> {
  const { data: existingGroups, error: fetchError } = await supabase
    .from("groups")
    .select("slug,status")
    .eq("status", "active");

  if (fetchError) {
    console.error("active groups 取得失敗", fetchError);
    return;
  }

  const toDeactivate = (existingGroups ?? [])
    .filter((group) => !activeCsvSlugs.has(group.slug as string))
    .map((group) => group.slug as string);

  if (toDeactivate.length === 0) {
    console.log("inactive 化対象の groups はありません");
    return;
  }

  const { error: deactivateError } = await supabase
    .from("groups")
    .update({
      status: "inactive",
      deleted_at: runAtIso,
      updated_at: runAtIso,
    })
    .in("slug", toDeactivate);

  if (deactivateError) {
    console.error("groups inactive 化失敗", deactivateError);
    return;
  }

  console.log(`groups inactive 化: ${toDeactivate.length}件`);
}

async function syncExternalIds(
  groupId: string,
  slug: string,
  externals: ExternalRecord[]
): Promise<void> {
  for (const ext of externals) {
    const { service, external_id, url } = ext;

    const { error: extError } = await supabase
      .from("external_ids")
      .upsert(
        {
          group_id: groupId,
          service,
          external_id,
          url,
        },
        { onConflict: "group_id,service" }
      );

    if (extError) {
      console.error(
        `external_ids upsert 失敗 slug="${slug}" service="${service}"`,
        extError
      );
    } else {
      console.log(`external_ids upsert 成功 slug="${slug}" service="${service}"`);
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("external_ids")
    .select("service")
    .eq("group_id", groupId);

  if (existingError) {
    console.error(`external_ids 既存取得失敗 slug="${slug}"`, existingError);
    return;
  }

  const keep = new Set(externals.map((v) => v.service));
  const deleteServices = (existing as ExistingExternal[] | null | undefined)
    ?.map((v) => v.service)
    .filter((service) => !keep.has(service));

  if (!deleteServices || deleteServices.length === 0) return;

  const { error: deleteError } = await supabase
    .from("external_ids")
    .delete()
    .eq("group_id", groupId)
    .in("service", deleteServices);

  if (deleteError) {
    console.error(
      `external_ids 削除失敗 slug="${slug}" services="${deleteServices.join(",")}"`,
      deleteError
    );
  } else {
    console.log(
      `external_ids 削除成功 slug="${slug}" services="${deleteServices.join(",")}"`
    );
  }
}

async function syncProfiles(
  groupId: string,
  slug: string,
  profiles: ProfileRecord[],
  runAtIso: string
): Promise<void> {
  for (const profile of profiles) {
    const { locale, body } = profile;

    const { error: profileError } = await supabase
      .from("group_profiles")
      .upsert(
        {
          group_id: groupId,
          locale,
          body,
          updated_at: runAtIso,
        },
        { onConflict: "group_id,locale" }
      );

    if (profileError) {
      console.error(
        `group_profiles upsert 失敗 slug="${slug}" locale="${locale}"`,
        profileError
      );
    } else {
      console.log(`group_profiles upsert 成功 slug="${slug}" locale="${locale}"`);
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("group_profiles")
    .select("locale")
    .eq("group_id", groupId);

  if (existingError) {
    console.error(`group_profiles 既存取得失敗 slug="${slug}"`, existingError);
    return;
  }

  const keep = new Set(profiles.map((v) => v.locale));
  const deleteLocales = (existing as ExistingProfile[] | null | undefined)
    ?.map((v) => v.locale)
    .filter((locale) => !keep.has(locale));

  if (!deleteLocales || deleteLocales.length === 0) return;

  const { error: deleteError } = await supabase
    .from("group_profiles")
    .delete()
    .eq("group_id", groupId)
    .in("locale", deleteLocales);

  if (deleteError) {
    console.error(
      `group_profiles 削除失敗 slug="${slug}" locales="${deleteLocales.join(",")}"`,
      deleteError
    );
  } else {
    console.log(
      `group_profiles 削除成功 slug="${slug}" locales="${deleteLocales.join(",")}"`
    );
  }
}

async function syncAttributes(
  groupId: string,
  slug: string,
  attributes: AttributeRecord[],
  runAtIso: string
): Promise<void> {
  for (const attribute of attributes) {
    const { key, locale, value } = attribute;

    const { error: attrError } = await supabase
      .from("group_attributes")
      .upsert(
        {
          group_id: groupId,
          key,
          locale,
          value,
          updated_at: runAtIso,
        },
        { onConflict: "group_id,key,locale" }
      );

    if (attrError) {
      console.error(
        `group_attributes upsert 失敗 slug="${slug}" key="${key}" locale="${locale}"`,
        attrError
      );
    } else {
      console.log(
        `group_attributes upsert 成功 slug="${slug}" key="${key}" locale="${locale}"`
      );
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("group_attributes")
    .select("id,key,locale")
    .eq("group_id", groupId);

  if (existingError) {
    console.error(`group_attributes 既存取得失敗 slug="${slug}"`, existingError);
    return;
  }

  const keep = new Set(attributes.map((v) => `${v.key}:${v.locale}`));
  const deleteIds = (existing as ExistingAttribute[] | null | undefined)
    ?.filter((v) => !keep.has(`${v.key}:${v.locale}`))
    .map((v) => v.id);

  if (!deleteIds || deleteIds.length === 0) return;

  const { error: deleteError } = await supabase
    .from("group_attributes")
    .delete()
    .in("id", deleteIds);

  if (deleteError) {
    console.error(`group_attributes 削除失敗 slug="${slug}"`, deleteError);
  } else {
    console.log(`group_attributes 削除成功 slug="${slug}" 件数=${deleteIds.length}`);
  }
}

async function main() {
  console.log("MASTER_profile.csv から IMDB へインポート開始");

  const rows = loadCsv();
  console.log(`読み込んだ行数: ${rows.length}`);
  const runAtIso = new Date().toISOString();
  const activeCsvSlugs = new Set<string>();
  // Standard mode: do NOT deactivate missing groups unless explicitly enabled.
  const deactivateMissing = process.env.DEACTIVATE_MISSING_GROUPS === "1";
  const allowEmptyDeactivation = process.env.ALLOW_EMPTY_CSV_DEACTIVATION === "1";

  for (const row of rows) {
    const slug = normalizeSlug(row.slug);
    if (!slug) {
      console.log(`slug が無い/不正のためスキップ: nameJapanese="${row.nameJapanese}"`);
      continue;
    }

    if (!row.nameJapanese) {
      console.log(`nameJapanese が無いのでスキップ: slug="${slug}"`);
      continue;
    }

    activeCsvSlugs.add(slug);

    // 1. groups に upsert
    const { data: group, error: groupError } = await supabase
    .from("groups")
    .upsert(
        {
        slug,
        name_ja: row.nameJapanese,
        status: "active",
        deleted_at: null,
        last_seen_at: runAtIso,
        updated_at: runAtIso
        },
        { onConflict: "slug" }
    )
    .select()
    .single();

    if (groupError || !group) {
      console.error(`groups upsert 失敗 slug="${slug}"`, groupError);
      continue;
    }

    const groupId = group.id as string;
    console.log(`groups upsert 成功 slug="${slug}" id="${groupId}"`);

    // 2. external_ids をサービスごとに upsert
    const externals = buildExternalRecords(row);
    await syncExternalIds(groupId, slug, externals);

    // 3. group_profiles を言語ごとに upsert
    const profiles = buildProfileRecords(row);
    await syncProfiles(groupId, slug, profiles, runAtIso);

    // 4. group_attributes を言語ごとに upsert
    const attributes = buildAttributeRecords(row);
    await syncAttributes(groupId, slug, attributes, runAtIso);
  }

  if (deactivateMissing) {
    if (!hasNonEmptyCsvRows(rows) && !allowEmptyDeactivation) {
      console.warn(
        "CSV有効行が0件のため inactive 化をスキップしました (ALLOW_EMPTY_CSV_DEACTIVATION=1 で許可)"
      );
    } else {
      await deactivateMissingGroups(activeCsvSlugs, runAtIso);
    }
  } else {
    console.log("groups の inactive 化はスキップしました (DEACTIVATE_MISSING_GROUPS=1 で有効化)");
  }

  console.log("インポート完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
