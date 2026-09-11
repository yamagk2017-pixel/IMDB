import assert from "node:assert/strict";
import test from "node:test";
import {
  findAvailableSlug,
  resolveUpdateSlug,
  selectApprovedRows,
  validatePublishIdentity,
} from "./operation.js";

test("手動公開はrequest_idでapproved行を1件に限定する", () => {
  const rows = [
    {
      rowNumber: 2,
      values: { request_id: "request-a", status: "approved" },
    },
    {
      rowNumber: 3,
      values: { request_id: "request-b", status: "approved" },
    },
    {
      rowNumber: 4,
      values: { request_id: "request-c", status: "review" },
    },
  ];

  assert.deepEqual(selectApprovedRows(rows, "request-b", 10), [rows[1]]);
  assert.throws(
    () => selectApprovedRows(rows, "request-c", 10),
    /approved状態/,
  );
});

test("更新はグループ名の一意な一致からslugを解決する", () => {
  assert.equal(
    resolveUpdateSlug({
      groupName: "AIBECK",
      masterSlugs: ["aibeck"],
      databaseSlug: "aibeck",
    }),
    "aibeck",
  );
  assert.throws(
    () =>
      resolveUpdateSlug({
        groupName: "同名グループ",
        masterSlugs: ["group-a", "group-b"],
        databaseSlug: null,
      }),
    /group_slugを指定/,
  );
});

test("新規登録の提案slugが使用済みなら未使用の連番を選ぶ", async () => {
  const used = new Set(["new-group", "new-group-2"]);
  assert.deepEqual(
    await findAvailableSlug("new-group", async (slug) => used.has(slug)),
    { slug: "new-group-3", adjusted: true },
  );
});

test("新規公開時のslug重複を拒否し、同一requestの再実行は許可する", () => {
  assert.throws(
    () =>
      validatePublishIdentity({
        requestType: "create",
        slug: "existing-group",
        requestId: "request-new",
        masterExists: true,
        masterRequestId: "request-old",
        databaseExists: true,
      }),
    /使用済み/,
  );
  assert.doesNotThrow(() =>
    validatePublishIdentity({
      requestType: "create",
      slug: "new-group",
      requestId: "request-1",
      masterExists: true,
      masterRequestId: "request-1",
      databaseExists: true,
    }),
  );
});

test("更新はMASTERまたはDBに対象slugが存在する場合だけ許可する", () => {
  assert.throws(
    () =>
      validatePublishIdentity({
        requestType: "update",
        slug: "missing-group",
        requestId: "request-1",
        masterExists: false,
        masterRequestId: null,
        databaseExists: false,
      }),
    /MASTERとDBに存在しません/,
  );
});
