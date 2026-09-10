import { google, sheets_v4 } from "googleapis";
import {
  WORKFLOW_COLUMNS,
  WORKFLOW_STATUSES,
  type WorkflowColumn,
  type WorkflowValues,
} from "./schema.js";

export type WorkflowRow = {
  rowNumber: number;
  values: WorkflowValues;
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
    const auth = new google.auth.GoogleAuth({
      credentials: loadGoogleCredentials(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const store = new WorkflowSheet(
      google.sheets({ version: "v4", auth }),
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
