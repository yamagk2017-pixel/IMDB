import "./env.js";
import {
  findGroupBySlug,
  publishApprovedRow,
  previewPublish,
  type PublishPreview,
} from "./database.js";
import {
  selectApprovedRows,
  validatePublishIdentity,
} from "./operation.js";
import { optionalCell, type WorkflowValues } from "./schema.js";
import { MasterSheet, WorkflowSheet } from "./sheets.js";

function isApplyMode(): boolean {
  return process.argv.includes("--apply");
}

function maxRows(): number {
  const argument = process.argv.find((value) => value.startsWith("--max-rows="));
  const raw = argument?.split("=")[1] ?? process.env.PROFILE_WORKFLOW_MAX_ROWS ?? "10";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error("max-rows は1〜50の整数にしてください");
  }
  return parsed;
}

function requestedRequestId(): string | null {
  return process.env.PROFILE_WORKFLOW_REQUEST_ID?.trim() || null;
}

function requireRequestIdForManualPublish(): void {
  if (
    process.env.PROFILE_WORKFLOW_REQUIRE_REQUEST_ID === "true" &&
    !requestedRequestId()
  ) {
    throw new Error(
      "手動publishではIMDB_PROFILE_WORKFLOWのrequest_idを指定してください",
    );
  }
}

async function validatePublishTarget(
  masterSheet: MasterSheet,
  preview: PublishPreview,
  values: WorkflowValues,
): Promise<void> {
  const [masterGroup, databaseGroup] = await Promise.all([
    masterSheet.findBySlug(preview.slug),
    findGroupBySlug(preview.slug),
  ]);

  const requestId = optionalCell(values.request_id);
  validatePublishIdentity({
    requestType: preview.requestType,
    slug: preview.slug,
    requestId,
    masterExists: Boolean(masterGroup),
    masterRequestId: masterGroup?.profileWorkflowRequestId ?? null,
    databaseExists: Boolean(databaseGroup),
  });
}

async function main(): Promise<void> {
  const apply = isApplyMode();
  requireRequestIdForManualPublish();
  const sheet = await WorkflowSheet.fromEnvironment();
  let masterSheet: MasterSheet | null = null;
  const approved = selectApprovedRows(
    await sheet.listRows(),
    requestedRequestId(),
    maxRows(),
  );
  console.log(`${apply ? "公開" : "公開プレビュー"}対象: ${approved.length}件`);

  for (const row of approved) {
    try {
      const preview = previewPublish(row.values);
      console.log(
        `${apply ? "公開" : "プレビュー"}: row=${row.rowNumber} slug=${preview.slug} fields=${preview.fields.join(",")}`,
      );
      if (!apply) continue;

      await sheet.patchRow(row.rowNumber, {
        status: "publishing",
        last_error: "",
      });
      masterSheet ??= await MasterSheet.fromEnvironment();
      await validatePublishTarget(masterSheet, preview, row.values);
      const masterResult = await masterSheet.upsertFromWorkflow(
        row.values,
        preview.requestType,
      );
      console.log(
        `MASTER転記: sheet=${process.env.GOOGLE_MASTER_SHEET_NAME?.trim() || "MASTER_test"} ` +
          `row=${masterResult.rowNumber ?? "unknown"} slug=${preview.slug} ` +
          `mode=${masterResult.created ? "append" : "update"}`,
      );
      await publishApprovedRow(row.values);
      await sheet.patchRow(row.rowNumber, {
        status: "published",
        published_at: new Date().toISOString(),
        last_error: "",
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 5_000);
      console.error(`公開失敗: row=${row.rowNumber}: ${message}`);
      if (apply) {
        await sheet.patchRow(row.rowNumber, {
          status: "publish_error",
          last_error: message,
        });
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
