import "./env.js";
import { randomUUID } from "node:crypto";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { loadExistingGroup } from "./database.js";
import { buildResearchPrompt } from "./prompt.js";
import {
  composeProfileJa,
  optionalCell,
  parseAgentJson,
  type WorkflowValues,
} from "./schema.js";
import { WorkflowSheet, type WorkflowRow } from "./sheets.js";

function maxRows(): number {
  const argument = process.argv.find((value) => value.startsWith("--max-rows="));
  const raw = argument?.split("=")[1] ?? process.env.PROFILE_WORKFLOW_MAX_ROWS ?? "3";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error("max-rows は1〜20の整数にしてください");
  }
  return parsed;
}

function repositoryUrl(): string {
  const configured = process.env.CURSOR_REPO_URL?.trim();
  if (configured) return configured;
  const githubRepository = process.env.GITHUB_REPOSITORY?.trim();
  if (githubRepository) return `https://github.com/${githubRepository}`;
  throw new Error("CURSOR_REPO_URL が設定されていません");
}

function errorMessage(error: unknown): string {
  if (error instanceof CursorAgentError) {
    return `${error.message} (retryable=${error.isRetryable})`;
  }
  return error instanceof Error ? error.message : String(error);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function generateOne(sheet: WorkflowSheet, row: WorkflowRow): Promise<void> {
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

  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  try {
    const existing = await loadExistingGroup(row.values.group_slug, groupName);
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) throw new Error("CURSOR_API_KEY が設定されていません");
    const modelId = process.env.CURSOR_MODEL?.trim() || "auto";
    const prompt = buildResearchPrompt({
      requestId,
      groupName,
      requestedSlug: optionalCell(row.values.group_slug),
      requestType: optionalCell(row.values.request_type),
      existing,
    });

    agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      cloud: {
        repos: [
          {
            url: repositoryUrl(),
            startingRef: process.env.CURSOR_REPO_REF?.trim() || "main",
          },
        ],
        autoCreatePR: false,
        skipReviewerRequest: true,
        metadata: { request_id: requestId, group_name: groupName },
      },
    });

    await sheet.patchRow(row.rowNumber, {
      agent_id: agent.agentId,
      current_data_json: existing ? json(existing) : "",
      model: modelId,
    });
    const run = await agent.send(prompt);
    await sheet.patchRow(row.rowNumber, { run_id: run.id });
    const runResult = await run.wait();
    if (runResult.status !== "finished" || !runResult.result) {
      throw new Error(
        `Codex実行が完了しませんでした: ${runResult.status} ${runResult.error?.message ?? ""}`,
      );
    }

    const result = parseAgentJson(runResult.result);
    const patch: WorkflowValues = {
      status: "review",
      group_name: result.canonical_name_ja,
      group_slug: optionalCell(row.values.group_slug) ?? existing?.group.slug ?? result.suggested_slug,
      request_type: existing ? "update" : "create",
      profile_ja: composeProfileJa(result),
      overview_ja: result.overview_ja,
      musical_style_ja: result.musical_style_ja,
      members_ja: result.attributes.members_ja ?? "",
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
      sources_json: json(result.sources),
      field_evidence_json: json(result.field_evidence),
      confidence_json: json(result.confidence),
      warnings_json: json(result.warnings),
      identity_notes: result.identity_notes,
      model: runResult.model?.id ?? modelId,
      generated_at: new Date().toISOString(),
      last_error: "",
    };
    await sheet.patchRow(row.rowNumber, patch);
    console.log(`生成完了: row=${row.rowNumber} group=${groupName} run=${run.id}`);
  } catch (error) {
    const message = errorMessage(error).slice(0, 5_000);
    await sheet.patchRow(row.rowNumber, {
      status: "generation_error",
      last_error: message,
    });
    console.error(`生成失敗: row=${row.rowNumber} group=${groupName}: ${message}`);
  } finally {
    if (agent) {
      try {
        await agent[Symbol.asyncDispose]();
      } catch (error) {
        console.error(`Codex Agentの終了処理に失敗しました: ${errorMessage(error)}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const sheet = await WorkflowSheet.fromEnvironment();
  const queued = (await sheet.listRows())
    .filter((row) => row.values.status?.trim().toLowerCase() === "queued")
    .slice(0, maxRows());
  console.log(`生成対象: ${queued.length}件`);
  for (const row of queued) await generateOne(sheet, row);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
