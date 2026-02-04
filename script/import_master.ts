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
  profileJa?: string;
  profileEn?: string;
  youtubeLink?: string;
  spotifyId?: string;
  websiteLink?: string;
  xLink?: string;
  instagramLink?: string;
  tiktokLink?: string;
  calendarLink?: string;
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

async function main() {
  console.log("MASTER_profile.csv から IMDB へインポート開始");

  const rows = loadCsv();
  console.log(`読み込んだ行数: ${rows.length}`);

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

    // 1. groups に upsert
    const { data: group, error: groupError } = await supabase
    .from("groups")
    .upsert(
        {
        slug,
        name_ja: row.nameJapanese,
        status: "active",
        updated_at: new Date().toISOString()
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
        console.log(
          `external_ids upsert 成功 slug="${slug}" service="${service}"`
        );
      }
    }

    // 3. group_profiles を言語ごとに upsert
    const profiles = buildProfileRecords(row);

    for (const profile of profiles) {
      const { locale, body } = profile;

      const { error: profileError } = await supabase
        .from("group_profiles")
        .upsert(
          {
            group_id: groupId,
            locale,
            body,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "group_id,locale" }
        );

      if (profileError) {
        console.error(
          `group_profiles upsert 失敗 slug="${slug}" locale="${locale}"`,
          profileError
        );
      } else {
        console.log(
          `group_profiles upsert 成功 slug="${slug}" locale="${locale}"`
        );
      }
    }
  }

  console.log("インポート完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
