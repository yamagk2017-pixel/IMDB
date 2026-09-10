import "./env.js";
import { publishApprovedRow, previewPublish } from "./database.js";
import { WorkflowSheet } from "./sheets.js";

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

async function main(): Promise<void> {
  const apply = isApplyMode();
  const sheet = await WorkflowSheet.fromEnvironment();
  const approved = (await sheet.listRows())
    .filter((row) => row.values.status?.trim().toLowerCase() === "approved")
    .slice(0, maxRows());
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
