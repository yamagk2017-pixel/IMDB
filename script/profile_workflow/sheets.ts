import { google, sheets_v4 } from "googleapis";
import {
  WORKFLOW_COLUMNS,
  WORKFLOW_REQUEST_TYPES,
  WORKFLOW_STATUSES,
  extractSpotifyArtistId,
  normalizeMembersJa,
  optionalCell,
  type WorkflowColumn,
  type WorkflowValues,
} from "./schema.js";

export type WorkflowRow = {
  rowNumber: number;
  values: WorkflowValues;
};

export const MASTER_MANAGED_COLUMNS = [
  "slug",
  "nameJapanese",
  "activityStartedMonth",
  "activityStartedBasis",
  "membersJa",
  "locationJa",
  "agencyJa",
  "profileJa",
  "youtubeLink",
  "spotifyId",
  "websiteLink",
  "xLink",
  "instagramLink",
  "tiktokLink",
  "calendarLink",
  "ticketdiveLink",
  "profileWorkflowRequestId",
] as const;

export type MasterManagedColumn = (typeof MASTER_MANAGED_COLUMNS)[number];
export type MasterValues = Partial<Record<MasterManagedColumn, string>>;

export type MasterUpsertResult = {
  rowNumber: number | null;
  created: boolean;
  columns: MasterManagedColumn[];
};

export type MasterIdentity = {
  rowNumber: number;
  slug: string;
  nameJapanese: string;
  profileWorkflowRequestId: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} が設定されていません`);
  return value;
}

function loadGoogleCredentials(): Record<string, unknown> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!json && !base64) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON または GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 が設定されていません",
    );
  }

  try {
    return JSON.parse(json ?? Buffer.from(base64!, "base64").toString("utf8"));
  } catch (error) {
    throw new Error("GoogleサービスアカウントJSONを解析できません", {
      cause: error,
    });
  }
}

function createSheetsClient(): sheets_v4.Sheets {
  const auth = new google.auth.GoogleAuth({
    credentials: loadGoogleCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function quoteSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function columnLetter(zeroBasedIndex: number): string {
  let value = zeroBasedIndex + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function requiredMasterCell(
  values: WorkflowValues,
  column: "group_slug" | "group_name" | "profile_ja",
): string {
  const value = optionalCell(values[column]);
  if (!value) throw new Error(`${column} が空のためMASTERシートへ転記できません`);
  return value;
}

/**
 * 承認用シートの値を、CSVインポーターと同じMASTER形式へ変換する。
 * 空欄は既存MASTER値を削除しないようパッチから除外する。
 */
export function masterValuesFromWorkflow(values: WorkflowValues): MasterValues {
  const result: MasterValues = {
    slug: requiredMasterCell(values, "group_slug"),
    nameJapanese: requiredMasterCell(values, "group_name"),
    profileJa: requiredMasterCell(values, "profile_ja"),
  };

  const requestId = optionalCell(values.request_id);
  if (requestId) result.profileWorkflowRequestId = requestId;

  const members = normalizeMembersJa(values.members_ja);
  if (members) result.membersJa = members;

  const spotify = optionalCell(values.spotify_url);
  if (spotify) {
    const artistId = extractSpotifyArtistId(spotify);
    if (!artistId) {
      throw new Error(`spotify_url からArtist IDを抽出できません: ${spotify}`);
    }
    result.spotifyId = artistId;
  }

  for (const [workflowColumn, masterColumn] of [
    ["activity_started_month", "activityStartedMonth"],
    ["activity_started_basis", "activityStartedBasis"],
    ["location_ja", "locationJa"],
    ["agency_ja", "agencyJa"],
    ["youtube_url", "youtubeLink"],
    ["website_url", "websiteLink"],
    ["x_url", "xLink"],
    ["instagram_url", "instagramLink"],
    ["tiktok_url", "tiktokLink"],
    ["calendar_url", "calendarLink"],
    ["ticketdive_url", "ticketdiveLink"],
  ] as const) {
    const value = optionalCell(values[workflowColumn]);
    if (value) result[masterColumn] = value;
  }

  return result;
}

export class WorkflowSheet {
  private readonly sheets: sheets_v4.Sheets;
  private readonly spreadsheetId: string;
  private readonly sheetName: string;
  private headers: string[] = [];

  private constructor(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string,
  ) {
    this.sheets = sheets;
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;
  }

  static async fromEnvironment(): Promise<WorkflowSheet> {
    const store = new WorkflowSheet(
      createSheetsClient(),
      requireEnv("GOOGLE_WORKFLOW_SPREADSHEET_ID"),
      process.env.GOOGLE_WORKFLOW_SHEET_NAME?.trim() || "IMDB_PROFILE_WORKFLOW",
    );
    await store.ensureSheet();
    return store;
  }

  async ensureSheet(): Promise<void> {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      includeGridData: false,
    });
    let sheet = spreadsheet.data.sheets?.find(
      (candidate) => candidate.properties?.title === this.sheetName,
    );

    if (!sheet) {
      const response = await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: this.sheetName,
                  gridProperties: {
                    rowCount: 2_000,
                    columnCount: Math.max(40, WORKFLOW_COLUMNS.length),
                    frozenRowCount: 1,
                  },
                },
              },
            },
          ],
        },
      });
      sheet = response.data.replies?.[0]?.addSheet;
    }

    const headerResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${quoteSheetName(this.sheetName)}!1:1`,
    });
    const existing = (headerResponse.data.values?.[0] ?? []).map(String);
    const missing = WORKFLOW_COLUMNS.filter((column) => !existing.includes(column));
    this.headers = [...existing, ...missing];

    if (existing.length === 0 || missing.length > 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${quoteSheetName(this.sheetName)}!A1:${columnLetter(this.headers.length - 1)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [this.headers] },
      });
    }

    const sheetId = sheet?.properties?.sheetId;
    const statusIndex = this.headers.indexOf("status");
    const requestTypeIndex = this.headers.indexOf("request_type");
    if (sheetId !== undefined && statusIndex >= 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: { frozenRowCount: 1 },
                },
                fields: "gridProperties.frozenRowCount",
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  startColumnIndex: statusIndex,
                  endColumnIndex: statusIndex + 1,
                },
                rule: {
                  condition: {
                    type: "ONE_OF_LIST",
                    values: WORKFLOW_STATUSES.map((status) => ({
                      userEnteredValue: status,
                    })),
                  },
                  strict: true,
                  showCustomUi: true,
                },
              },
            },
            ...(requestTypeIndex >= 0
              ? [
                  {
                    setDataValidation: {
                      range: {
                        sheetId,
                        startRowIndex: 1,
                        startColumnIndex: requestTypeIndex,
                        endColumnIndex: requestTypeIndex + 1,
                      },
                      rule: {
                        condition: {
                          type: "ONE_OF_LIST" as const,
                          values: WORKFLOW_REQUEST_TYPES.map((requestType) => ({
                            userEnteredValue: requestType,
                          })),
                        },
                        strict: true,
                        showCustomUi: true,
                      },
                    },
                  },
                ]
              : []),
          ],
        },
      });
    }
  }

  async listRows(): Promise<WorkflowRow[]> {
    const lastColumn = columnLetter(this.headers.length - 1);
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${quoteSheetName(this.sheetName)}!A2:${lastColumn}`,
    });

    return (response.data.values ?? []).map((cells, index) => {
      const values: WorkflowValues = {};
      this.headers.forEach((header, columnIndex) => {
        if (!WORKFLOW_COLUMNS.includes(header as WorkflowColumn)) return;
        values[header as WorkflowColumn] = String(cells[columnIndex] ?? "");
      });
      return { rowNumber: index + 2, values };
    });
  }

  async patchRow(rowNumber: number, patch: WorkflowValues): Promise<void> {
    const data = Object.entries(patch).map(([column, value]) => {
      const index = this.headers.indexOf(column);
      if (index < 0) throw new Error(`シートに列がありません: ${column}`);
      const cell = `${columnLetter(index)}${rowNumber}`;
      return {
        range: `${quoteSheetName(this.sheetName)}!${cell}`,
        values: [[value ?? ""]],
      };
    });
    if (data.length === 0) return;

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
  }

}

/**
 * MASTER_testを正本として維持するためのシート操作。
 * slugが一致する既存行は管理対象列だけ更新し、なければ新規行を追加する。
 */
export class MasterSheet {
  private readonly sheets: sheets_v4.Sheets;
  private readonly spreadsheetId: string;
  private readonly sheetName: string;
  private headers: string[] = [];

  private constructor(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string,
  ) {
    this.sheets = sheets;
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;
  }

  static async fromEnvironment(): Promise<MasterSheet> {
    const store = new MasterSheet(
      createSheetsClient(),
      requireEnv("GOOGLE_WORKFLOW_SPREADSHEET_ID"),
      process.env.GOOGLE_MASTER_SHEET_NAME?.trim() || "MASTER_test",
    );
    await store.loadAndEnsureHeaders();
    return store;
  }

  private async loadAndEnsureHeaders(): Promise<void> {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      includeGridData: false,
    });
    const sheet = spreadsheet.data.sheets?.find(
      (candidate) => candidate.properties?.title === this.sheetName,
    );
    if (!sheet) {
      throw new Error(`MASTERシートが存在しません: ${this.sheetName}`);
    }

    const headerResponse = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${quoteSheetName(this.sheetName)}!1:1`,
    });
    const existing = (headerResponse.data.values?.[0] ?? []).map(String);
    if (existing.length === 0) {
      throw new Error(`MASTERシートのヘッダーが空です: ${this.sheetName}`);
    }
    if (!existing.includes("slug")) {
      throw new Error(`MASTERシートにslug列がありません: ${this.sheetName}`);
    }

    const missing = MASTER_MANAGED_COLUMNS.filter(
      (column) => !existing.includes(column),
    );
    this.headers = [...existing, ...missing];
    if (missing.length > 0) {
      const sheetId = sheet.properties?.sheetId;
      const columnCount = sheet.properties?.gridProperties?.columnCount ?? 0;
      if (sheetId !== undefined && columnCount < this.headers.length) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId,
                    gridProperties: { columnCount: this.headers.length },
                  },
                  fields: "gridProperties.columnCount",
                },
              },
            ],
          },
        });
      }
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${quoteSheetName(this.sheetName)}!A1:${columnLetter(this.headers.length - 1)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [this.headers] },
      });
    }
  }

  private async listIdentities(): Promise<MasterIdentity[]> {
    const columns = ["slug", "nameJapanese", "profileWorkflowRequestId"] as const;
    const ranges = columns.map((column) => {
      const letter = columnLetter(this.headers.indexOf(column));
      return `${quoteSheetName(this.sheetName)}!${letter}2:${letter}`;
    });
    const response = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: this.spreadsheetId,
      ranges,
    });
    const valueRanges = response.data.valueRanges ?? [];
    const valuesByColumn = columns.map(
      (_, index) => valueRanges[index]?.values ?? [],
    );
    const rowCount = Math.max(0, ...valuesByColumn.map((values) => values.length));

    return Array.from({ length: rowCount }, (_, index) => ({
      rowNumber: index + 2,
      slug: String(valuesByColumn[0][index]?.[0] ?? "").trim(),
      nameJapanese: String(valuesByColumn[1][index]?.[0] ?? "").trim(),
      profileWorkflowRequestId: String(
        valuesByColumn[2][index]?.[0] ?? "",
      ).trim(),
    })).filter((identity) => identity.slug || identity.nameJapanese);
  }

  async findBySlug(slug: string): Promise<MasterIdentity | null> {
    const matches = (await this.listIdentities()).filter(
      (identity) => identity.slug === slug.trim(),
    );
    if (matches.length > 1) {
      throw new Error(`MASTERシートに同じslugの行が複数あります: ${slug}`);
    }
    return matches[0] ?? null;
  }

  async findByName(groupName: string): Promise<MasterIdentity[]> {
    const target = groupName.trim().normalize("NFKC").toLocaleLowerCase("ja");
    return (await this.listIdentities()).filter(
      (identity) =>
        identity.nameJapanese
          .normalize("NFKC")
          .toLocaleLowerCase("ja") === target,
    );
  }

  async upsertFromWorkflow(
    values: WorkflowValues,
    requestType: "create" | "update",
  ): Promise<MasterUpsertResult> {
    const patch = masterValuesFromWorkflow(values);
    const slug = patch.slug!;
    const matchingRow = await this.findBySlug(slug);
    if (
      requestType === "create" &&
      matchingRow &&
      (!patch.profileWorkflowRequestId ||
        matchingRow.profileWorkflowRequestId !== patch.profileWorkflowRequestId)
    ) {
      throw new Error(
        `新規登録のslugがMASTERで使用済みです: ${slug}`,
      );
    }

    const entries = Object.entries(patch) as Array<
      [MasterManagedColumn, string]
    >;
    const columns = entries.map(([column]) => column);
    if (matchingRow) {
      const rowNumber = matchingRow.rowNumber;
      const data = entries.map(([column, value]) => {
        const cell = `${columnLetter(this.headers.indexOf(column))}${rowNumber}`;
        return {
          range: `${quoteSheetName(this.sheetName)}!${cell}`,
          values: [[value]],
        };
      });
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      });
      return { rowNumber, created: false, columns };
    }

    const row = this.headers.map((header) => patch[header as MasterManagedColumn] ?? "");
    const appendResponse = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${quoteSheetName(this.sheetName)}!A:${columnLetter(this.headers.length - 1)}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    const updatedRange = appendResponse.data.updates?.updatedRange ?? "";
    const rowMatch = updatedRange.match(/!(?:[A-Z]+)(\d+):/);
    return {
      rowNumber: rowMatch ? Number.parseInt(rowMatch[1], 10) : null,
      created: true,
      columns,
    };
  }
}
