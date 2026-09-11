import type {
  WorkflowRequestType,
  WorkflowValues,
} from "./schema.js";

type WorkflowRowLike = {
  rowNumber: number;
  values: WorkflowValues;
};

export function selectApprovedRows(
  rows: WorkflowRowLike[],
  requestId: string | null,
  maxRows: number,
): WorkflowRowLike[] {
  const normalizedRequestId = requestId?.trim() || null;
  const approved = rows.filter(
    (row) => row.values.status?.trim().toLowerCase() === "approved",
  );
  const selected = normalizedRequestId
    ? approved.filter(
        (row) => row.values.request_id?.trim() === normalizedRequestId,
      )
    : approved;

  if (normalizedRequestId && selected.length === 0) {
    throw new Error(
      `approved状態のrequest_idが見つかりません: ${normalizedRequestId}`,
    );
  }
  if (normalizedRequestId && selected.length > 1) {
    throw new Error(
      `同じrequest_idのapproved行が複数あります: ${normalizedRequestId}`,
    );
  }
  return selected.slice(0, maxRows);
}

export function resolveUpdateSlug(input: {
  groupName: string;
  masterSlugs: string[];
  databaseSlug: string | null;
}): string {
  const masterSlugs = input.masterSlugs.filter(Boolean);
  const candidateSlugs = new Set([
    ...masterSlugs,
    ...(input.databaseSlug ? [input.databaseSlug] : []),
  ]);
  if (candidateSlugs.size === 0) {
    throw new Error(
      `グループ名に一致する更新対象が見つかりません: ${input.groupName}`,
    );
  }
  if (candidateSlugs.size > 1 || masterSlugs.length > 1) {
    throw new Error(
      `グループ名に一致する候補が複数あります。group_slugを指定してください: ${input.groupName}`,
    );
  }
  return [...candidateSlugs][0];
}

export async function findAvailableSlug(
  suggestedSlug: string,
  isUsed: (slug: string) => Promise<boolean>,
): Promise<{ slug: string; adjusted: boolean }> {
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? suggestedSlug : `${suggestedSlug}-${suffix}`;
    if (!(await isUsed(slug))) return { slug, adjusted: suffix > 1 };
  }
  throw new Error(`使用可能なslugを生成できません: ${suggestedSlug}`);
}

export function validatePublishIdentity(input: {
  requestType: WorkflowRequestType;
  slug: string;
  requestId: string | null;
  masterExists: boolean;
  masterRequestId: string | null;
  databaseExists: boolean;
}): void {
  if (input.requestType === "update") {
    if (!input.masterExists && !input.databaseExists) {
      throw new Error(
        `更新対象のslugがMASTERとDBに存在しません: ${input.slug}`,
      );
    }
    return;
  }

  if (!input.requestId) {
    throw new Error(
      "新規登録にはrequest_idが必要です。生成処理からやり直してください",
    );
  }
  const isRetry = input.masterRequestId === input.requestId;
  if ((input.masterExists || input.databaseExists) && !isRetry) {
    throw new Error(`新規登録のslugが使用済みです: ${input.slug}`);
  }
}
