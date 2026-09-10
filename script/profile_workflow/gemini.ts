import { GoogleGenAI } from "@google/genai";
import { parseResearchJson, type ResearchResult } from "./schema.js";

// Gemini supports a subset of JSON Schema. Keep this deliberately simple and
// rely on the stricter Zod validation in schema.ts after generation.
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableUrl = {
  anyOf: [{ type: "string", format: "uri" }, { type: "null" }],
};

export const researchResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: ["1.0"] },
    canonical_name_ja: { type: "string" },
    suggested_slug: { type: "string" },
    identity_confirmed: { type: "boolean" },
    identity_notes: { type: "string" },
    overview_ja: { type: "string" },
    musical_style_ja: { type: "string" },
    attributes: {
      type: "object",
      additionalProperties: false,
      properties: {
        members_ja: nullableString,
        location_ja: nullableString,
        agency_ja: nullableString,
        activity_started_month: nullableString,
        activity_started_basis: {
          anyOf: [
            {
              type: "string",
              enum: ["formation", "debut", "first_show", "relaunch", "unknown"],
            },
            { type: "null" },
          ],
        },
      },
      required: [
        "members_ja",
        "location_ja",
        "agency_ja",
        "activity_started_month",
        "activity_started_basis",
      ],
    },
    external_links: {
      type: "object",
      additionalProperties: false,
      properties: {
        website_url: nullableUrl,
        x_url: nullableUrl,
        instagram_url: nullableUrl,
        tiktok_url: nullableUrl,
        youtube_url: nullableUrl,
        spotify_url: nullableUrl,
      },
      required: [
        "website_url",
        "x_url",
        "instagram_url",
        "tiktok_url",
        "youtube_url",
        "spotify_url",
      ],
    },
    sources: {
      type: "array",
      minItems: 2,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          publisher: { type: "string" },
          accessed_at: { type: "string" },
          source_type: {
            type: "string",
            enum: ["official", "primary", "platform", "secondary"],
          },
          supports: { type: "array", minItems: 1, items: { type: "string" } },
        },
        required: [
          "url",
          "title",
          "publisher",
          "accessed_at",
          "source_type",
          "supports",
        ],
      },
    },
    field_evidence: {
      type: "object",
      additionalProperties: {
        type: "array",
        minItems: 1,
        items: { type: "string", format: "uri" },
      },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        identity: { type: "number", minimum: 0, maximum: 1 },
        profile: { type: "number", minimum: 0, maximum: 1 },
        attributes: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["identity", "profile", "attributes"],
    },
    warnings: { type: "array", maxItems: 30, items: { type: "string" } },
  },
  required: [
    "schema_version",
    "canonical_name_ja",
    "suggested_slug",
    "identity_confirmed",
    "identity_notes",
    "overview_ja",
    "musical_style_ja",
    "attributes",
    "external_links",
    "sources",
    "field_evidence",
    "confidence",
    "warnings",
  ],
} as const;

export type GeminiResearchResponse = {
  result: ResearchResult;
  requestId: string | null;
  model: string;
};

export async function generateProfileWithGemini(input: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<GeminiResearchResponse> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const response = await client.interactions.create({
    model: input.model,
    input: input.prompt,
    tools: [{ type: "google_search" }],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: researchResponseJsonSchema,
    },
    generation_config: {
      max_output_tokens: 8_192,
      thinking_level: "medium",
    },
    store: false,
  }, {
    timeout_ms: 600_000,
    retries: { strategy: "none" },
  });

  const raw = response.output_text?.trim();
  if (!raw) {
    const details = response.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      details
        ? `Geminiから本文が返りませんでした: ${details}`
        : "Geminiから本文が返りませんでした",
    );
  }

  return {
    result: parseResearchJson(raw),
    requestId: response.id ?? null,
    model: response.model ?? input.model,
  };
}
