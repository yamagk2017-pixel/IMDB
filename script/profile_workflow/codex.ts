import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  WORKFLOW_COLUMNS,
  WORKFLOW_REQUEST_TYPES,
  composeProfileJa,
  normalizeMembersJa,
  reviewNoteForResearch,
  researchResultSchema,
  type WorkflowValues,
} from "./schema.js";

const codexProfileInputSchema = z.object({
  group_name: z.string().trim().min(1).max(200),
  group_slug: z.string().regex(/^[a-z0-9-]+$/),
  request_type: z.enum(WORKFLOW_REQUEST_TYPES),
  current_data: z.unknown().optional(),
  research: researchResultSchema,
});

export type CodexProfileInput = z.infer<typeof codexProfileInputSchema>;

export type CodexWorkflowOutput = {
  columns: readonly string[];
  values: WorkflowValues;
  ordered_values: string[];
};

type BuildOptions = {
  requestId?: string;
  now?: Date;
  agentId?: string;
  runId?: string;
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function buildCodexWorkflowOutput(
  rawInput: unknown,
  options: BuildOptions = {},
): CodexWorkflowOutput {
  const input = codexProfileInputSchema.parse(rawInput);
  const result = input.research;
  const timestamp = (options.now ?? new Date()).toISOString();
  const requestId = options.requestId ?? randomUUID();

  const values: WorkflowValues = {
    request_id: requestId,
    status: "review",
    group_name: result.canonical_name_ja,
    group_slug: input.group_slug,
    request_type: input.request_type,
    profile_ja: composeProfileJa(result),
    overview_ja: result.overview_ja,
    musical_style_ja: result.musical_style_ja,
    members_ja: normalizeMembersJa(result.attributes.members_ja) ?? "",
    location_ja: result.attributes.location_ja ?? "",
    agency_ja: result.attributes.agency_ja ?? "",
    activity_started_month: result.attributes.activity_started_month ?? "",
    activity_started_basis: result.attributes.activity_started_basis ?? "",
    website_url: result.external_links.website_url ?? "",
    x_url: result.external_links.x_url ?? "",
    instagram_url: result.external_links.instagram_url ?? "",
    tiktok_url: result.external_links.tiktok_url ?? "",
    youtube_url: result.external_links.youtube_url ?? "",
    spotify_url: result.external_links.spotify_url ?? "",
    calendar_url: result.external_links.calendar_url ?? "",
    ticketdive_url: result.external_links.ticketdive_url ?? "",
    sources_json: json(result.sources),
    field_evidence_json: json(result.field_evidence),
    confidence_json: json(result.confidence),
    warnings_json: json(result.warnings),
    identity_notes: result.identity_notes,
    current_data_json:
      input.current_data === undefined || input.current_data === null
        ? ""
        : json(input.current_data),
    model: "codex-chat",
    agent_id: options.agentId ?? "codex",
    run_id: options.runId ?? "",
    review_note: `Codexが調査・生成。${reviewNoteForResearch(result)}`,
    last_error: "",
    requested_at: timestamp,
    generated_at: timestamp,
    published_at: "",
  };

  return {
    columns: WORKFLOW_COLUMNS,
    values,
    ordered_values: WORKFLOW_COLUMNS.map((column) => values[column] ?? ""),
  };
}

function argument(name: string): string | null {
  const withEquals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const inputPath = argument("input");
  if (!inputPath) {
    throw new Error(
      "--input=<Codex調査結果JSONのパス> を指定してください",
    );
  }
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  const output = buildCodexWorkflowOutput(raw, {
    requestId: argument("request-id") ?? undefined,
    runId: argument("run-id") ?? undefined,
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
