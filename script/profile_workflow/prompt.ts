import fs from "node:fs";
import path from "node:path";
import type { ExistingGroupContext } from "./database.js";

const instructionPath = path.resolve(
  process.cwd(),
  "prompts/imdb_profile_research.md",
);

export function buildResearchPrompt(input: {
  requestId: string;
  groupName: string;
  requestedSlug: string | null;
  requestType: string | null;
  existing: ExistingGroupContext | null;
}): string {
  const instructions = fs.readFileSync(instructionPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  return `${instructions}\n\n## 今回の依頼\n\n${JSON.stringify(
    {
      current_date: today,
      request_id: input.requestId,
      group_name_input: input.groupName,
      requested_slug: input.requestedSlug,
      request_type: input.requestType ?? "auto",
      existing_imdb_data: input.existing,
    },
    null,
    2,
  )}\n\n上記の対象だけを調査し、指定されたJSONオブジェクトを1個だけ最終回答として返してください。リポジトリ内のファイルは変更しないでください。`;
}
