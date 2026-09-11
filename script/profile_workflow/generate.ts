import "./env.js";
import { randomUUID } from "node:crypto";
import {
  findGroupBySlug,
  loadExistingGroup,
  type ExistingGroupContext,
} from "./database.js";
import { generateProfileWithGemini } from "./gemini.js";
import { resolveResearchExternalLinks } from "./external_links.js";
import { findAvailableSlug, resolveUpdateSlug } from "./operation.js";
import { buildResearchPrompt } from "./prompt.js";
import {
  composeProfileJa,
  normalizeMembersJa,
  optionalCell,
  parseWorkflowRequestType,
  type WorkflowValues,
} from "./schema.js";
import { MasterSheet, WorkflowSheet, type WorkflowRow } from "./sheets.js";

type ResolvedRequest = {
  requestType: "create" | "update";
  groupSlug: string | null;
  existing: ExistingGroupContext | null;
};

function maxRows(): number {
  const argument = process.argv.find((value) => value.startsWith("--max-rows="));
  const raw = argument?.split("=")[1] ?? process.env.PROFILE_WORKFLOW_MAX_ROWS ?? "3";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error("max-rows は1〜20の整数にしてください");
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function resolveRequest(
  masterSheet: MasterSheet,
  values: WorkflowRow["values"],
  groupName: string,
): Promise<ResolvedRequest> {
  const requestType = parseWorkflowRequestType(values.request_type);
  const requestedSlug = optionalCell(values.group_slug);

  if (requestType === "create") {
    if (requestedSlug) {
      const [masterGroup, databaseGroup] = await Promise.all([
        masterSheet.findBySlug(requestedSlug),
        findGroupBySlug(requestedSlug),
      ]);
      if (masterGroup || databaseGroup) {
        throw new Error(
          `新規登録のslugは使用済みです: ${requestedSlug}`,
        );
      }
    }

    const [masterNameMatches, databaseNameMatch] = await Promise.all([
      masterSheet.findByName(groupName),
      loadExistingGroup(undefined, groupName),
    ]);
    if (masterNameMatches.length > 0 || databaseNameMatch) {
      throw new Error(
        `同じグループ名の登録が存在します。updateを選択してください: ${groupName}`,
      );
    }
    return { requestType, groupSlug: requestedSlug, existing: null };
  }

  if (requestedSlug) {
    const [masterGroup, databaseGroup] = await Promise.all([
      masterSheet.findBySlug(requestedSlug),
      loadExistingGroup(requestedSlug, groupName),
    ]);
    if (!masterGroup && !databaseGroup) {
      throw new Error(`更新対象のslugが見つかりません: ${requestedSlug}`);
    }
    return {
      requestType,
      groupSlug: requestedSlug,
      existing: databaseGroup,
    };
  }

  const [masterMatches, databaseMatch] = await Promise.all([
    masterSheet.findByName(groupName),
    loadExistingGroup(undefined, groupName),
  ]);
  const groupSlug = resolveUpdateSlug({
    groupName,
    masterSlugs: masterMatches.map((match) => match.slug),
    databaseSlug: databaseMatch?.group.slug ?? null,
  });
  const existing =
    databaseMatch?.group.slug === groupSlug
      ? databaseMatch
      : await loadExistingGroup(groupSlug, groupName);
  return { requestType, groupSlug, existing };
}

async function uniqueGeneratedSlug(
  masterSheet: MasterSheet,
  suggestedSlug: string,
): Promise<{ slug: string; adjusted: boolean }> {
  return findAvailableSlug(suggestedSlug, async (slug) => {
    const [masterGroup, databaseGroup] = await Promise.all([
      masterSheet.findBySlug(slug),
      findGroupBySlug(slug),
    ]);
    return Boolean(masterGroup || databaseGroup);
  });
}

async function generateOne(
  sheet: WorkflowSheet,
  masterSheet: MasterSheet,
  row: WorkflowRow,
): Promise<void> {
  const groupName = optionalCell(row.values.group_name);
  if (!groupName) {
    await sheet.patchRow(row.rowNumber, {
      status: "generation_error",
      last_error: "group_name が空です",
    });
    return;
  }

  const requestId = optionalCell(row.values.request_id) ?? randomUUID();
  const requestedAt = optionalCell(row.values.requested_at) ?? new Date().toISOString();
  await sheet.patchRow(row.rowNumber, {
    request_id: requestId,
    status: "generating",
    requested_at: requestedAt,
    last_error: "",
  });

  try {
    const resolved = await resolveRequest(masterSheet, row.values, groupName);
    const existing = resolved.existing;
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");
    const modelId = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
    const fallbackModelId =
      process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.6-flash";
    const prompt = buildResearchPrompt({
      requestId,
      groupName,
      requestedSlug: resolved.groupSlug,
      requestType: resolved.requestType,
      existing,
    });

    await sheet.patchRow(row.rowNumber, {
      agent_id: "gemini-api",
      current_data_json: existing ? json(existing) : "",
      model: modelId,
    });
    const generated = await generateProfileWithGemini({
      apiKey,
      model: modelId,
      fallbackModel: fallbackModelId,
      prompt,
    });
    const result = await resolveResearchExternalLinks({
      result: generated.result,
      requestedName: groupName,
      existingLinks: existing?.external_links,
    });
    const generatedSlug =
      resolved.requestType === "create" && !resolved.groupSlug
        ? await uniqueGeneratedSlug(masterSheet, result.suggested_slug)
        : { slug: resolved.groupSlug!, adjusted: false };
    const warnings = [...result.warnings];
    if (generatedSlug.adjusted) {
      warnings.push(
        `slug: 提案値 ${result.suggested_slug} は使用済みのため ${generatedSlug.slug} に変更しました`,
      );
    }
    const patch: WorkflowValues = {
      status: "review",
      group_name: result.canonical_name_ja,
      group_slug: generatedSlug.slug,
      request_type: resolved.requestType,
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
      warnings_json: json(warnings),
      identity_notes: result.identity_notes,
      model: generated.model,
      run_id: generated.requestId ?? "",
      generated_at: new Date().toISOString(),
      last_error: "",
    };
    await sheet.patchRow(row.rowNumber, patch);
    console.log(
      `生成完了: row=${row.rowNumber} group=${groupName} request=${generated.requestId ?? "unknown"}`,
    );
  } catch (error) {
    const message = errorMessage(error).slice(0, 5_000);
    await sheet.patchRow(row.rowNumber, {
      status: "generation_error",
      last_error: message,
    });
    console.error(`生成失敗: row=${row.rowNumber} group=${groupName}: ${message}`);
  }
}

async function main(): Promise<void> {
  const sheet = await WorkflowSheet.fromEnvironment();
  const queued = (await sheet.listRows())
    .filter((row) => row.values.status?.trim().toLowerCase() === "queued")
    .slice(0, maxRows());
  console.log(`生成対象: ${queued.length}件`);
  if (queued.length === 0) return;
  const masterSheet = await MasterSheet.fromEnvironment();
  for (const row of queued) await generateOne(sheet, masterSheet, row);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
