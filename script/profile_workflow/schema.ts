import { z } from "zod";

export const WORKFLOW_STATUSES = [
  "queued",
  "generating",
  "review",
  "approved",
  "publishing",
  "published",
  "generation_error",
  "publish_error",
] as const;

export const WORKFLOW_COLUMNS = [
  "request_id",
  "status",
  "group_name",
  "group_slug",
  "request_type",
  "profile_ja",
  "overview_ja",
  "musical_style_ja",
  "members_ja",
  "location_ja",
  "agency_ja",
  "activity_started_month",
  "activity_started_basis",
  "website_url",
  "x_url",
  "instagram_url",
  "tiktok_url",
  "youtube_url",
  "spotify_url",
  "sources_json",
  "field_evidence_json",
  "confidence_json",
  "warnings_json",
  "identity_notes",
  "current_data_json",
  "model",
  "agent_id",
  "run_id",
  "review_note",
  "last_error",
  "requested_at",
  "generated_at",
  "published_at",
] as const;

export type WorkflowColumn = (typeof WORKFLOW_COLUMNS)[number];
export type WorkflowValues = Partial<Record<WorkflowColumn, string>>;

const nullableText = z.union([z.string().trim().min(1), z.null()]);
const nullableUrl = z.union([z.string().url().startsWith("http"), z.null()]);

export const sourceSchema = z.object({
  url: z.string().url().startsWith("http"),
  title: z.string().trim().min(1),
  publisher: z.string().trim().min(1),
  accessed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_type: z.enum(["official", "primary", "platform", "secondary"]),
  supports: z.array(z.string().trim().min(1)).min(1),
});

const cleanProfileText = z
  .string()
  .trim()
  .min(60)
  .max(1_200)
  .refine(
    (value) => !/(?:cite|turn\d+(?:search|view)|view\d+)/i.test(value),
    "プロフィール本文に内部引用記号を含めることはできません",
  );

export const researchResultSchema = z
  .object({
    schema_version: z.literal("1.0"),
    canonical_name_ja: z.string().trim().min(1).max(200),
    suggested_slug: z.string().regex(/^[a-z0-9-]+$/),
    identity_confirmed: z.boolean(),
    identity_notes: z.string().trim().max(1_000),
    overview_ja: cleanProfileText,
    musical_style_ja: cleanProfileText,
    attributes: z.object({
      members_ja: nullableText,
      location_ja: nullableText,
      agency_ja: nullableText,
      activity_started_month: z.union([
        z.string().regex(/^\d{4}-\d{2}$/),
        z.null(),
      ]),
      activity_started_basis: z.union([
        z.enum(["formation", "debut", "first_show", "relaunch", "unknown"]),
        z.null(),
      ]),
    }),
    external_links: z.object({
      website_url: nullableUrl,
      x_url: nullableUrl,
      instagram_url: nullableUrl,
      tiktok_url: nullableUrl,
      youtube_url: nullableUrl,
      spotify_url: nullableUrl,
    }),
    sources: z.array(sourceSchema).min(2).max(20),
    field_evidence: z.record(z.string(), z.array(z.string().url()).min(1)),
    confidence: z.object({
      identity: z.number().min(0).max(1),
      profile: z.number().min(0).max(1),
      attributes: z.number().min(0).max(1),
    }),
    warnings: z.array(z.string().trim().min(1)).max(30),
  })
  .superRefine((value, context) => {
    const sourceUrls = new Set(value.sources.map((source) => source.url));
    for (const [index, source] of value.sources.entries()) {
      const parsed = new URL(source.url);
      const isTopPage = (parsed.pathname === "" || parsed.pathname === "/") &&
        !parsed.search && !parsed.hash;
      if (source.source_type === "secondary" && isTopPage) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "url"],
          message: "二次情報にはサイトのトップではなく個別記事のURLが必要です",
        });
      }
    }

    for (const [field, urls] of Object.entries(value.field_evidence)) {
      for (const url of urls) {
        if (!sourceUrls.has(url)) {
          context.addIssue({
            code: "custom",
            path: ["field_evidence", field],
            message: `sources に存在しないURLです: ${url}`,
          });
        }
      }
    }

    if (!value.identity_confirmed) {
      context.addIssue({
        code: "custom",
        path: ["identity_confirmed"],
        message: "グループ同定に失敗した結果はレビューへ送れません",
      });
    }
  });

export type ResearchResult = z.infer<typeof researchResultSchema>;

export function composeProfileJa(result: ResearchResult): string {
  return `${result.overview_ja}\n\n${result.musical_style_ja}`;
}

export function parseResearchJson(raw: string): ResearchResult {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  let lastError: unknown;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return researchResultSchema.parse(JSON.parse(candidate));
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof z.ZodError) {
    const details = lastError.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`生成結果の検証に失敗しました: ${details}`);
  }
  throw new Error("生成結果をJSONとして解析できませんでした");
}

export function normalizeMonthForDatabase(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`activity_started_month の形式が不正です: ${value}`);
  }
  return `${value}-01`;
}

export function optionalCell(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
