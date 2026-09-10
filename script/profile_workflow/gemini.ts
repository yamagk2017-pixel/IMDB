import { GoogleGenAI, ThinkingLevel } from "@google/genai";
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
  fallbackModel?: string;
  prompt: string;
}): Promise<GeminiResearchResponse> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const models = [...new Set([input.model, input.fallbackModel].filter(Boolean))] as string[];
  const failures: string[] = [];

  for (const [index, model] of models.entries()) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: input.prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseJsonSchema: researchResponseJsonSchema,
          maxOutputTokens: 8_192,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          httpOptions: {
            timeout: 240_000,
            retryOptions: { attempts: 1 },
          },
        },
      });

      const raw = response.text?.trim();
      if (!raw) {
        throw new Error("Geminiから本文が返りませんでした");
      }

      return {
        result: parseResearchJson(raw),
        requestId: response.responseId ?? null,
        model: response.modelVersion ?? model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}: ${message}`);
      const retryable = /\b(?:408|429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed|timed? ?out/i.test(
        message,
      );
      const qualityRetryable = message.includes("生成結果の検証に失敗しました");
      const hasFallback = index < models.length - 1;
      if ((!retryable && !qualityRetryable) || !hasFallback) break;

      const delayMs = 2_000 + Math.floor(Math.random() * 1_000);
      console.warn(
        `Gemini再生成: model=${model}; ${delayMs}ms後にmodel=${models[index + 1]}へ切り替えます`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Gemini生成に失敗しました: ${failures.join(" / ")}`);
}
