import "server-only";
import { createSign } from "crypto";
import { readFileSync } from "fs";

export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const DEFAULT_SACRED_SHEET_ID = "1pTj0G-cXt30Vx2A_qiLwIA9M2rQ4tqZPe60AGnUwcis";
export const DEFAULT_UNDERUTILISING_SHEET_ID =
  "1r1Rr3_T08uYEAMhHfM5uFtoNwW78OWEzy5XskqbEcjw";
export const DEFAULT_UNDERUTILISING_SHEET_GID = 1728088364;
export const DEFAULT_UNDERUTILISING_SHEET_PUBLISH_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQycuglKCuM7kowqEJffiFr9WqcuyqCxh98RK8l48yUoAtLMBcRaSKe1p_TKBTHnKIgo2PbVhcRu_ve/pub?gid=1728088364&single=true&output=csv";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const SHEETS_RW_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

// Cache access tokens per scope until shortly before they expire.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getServiceAccountToken(
  sa: ServiceAccount,
  scope: string = READONLY_SCOPE
): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(sa.private_key, "base64url");
  const jwt = `${signInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google auth failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google auth: no access_token");
  tokenCache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

export function loadServiceAccount(): ServiceAccount | null {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  const path = process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    return JSON.parse(readFileSync(path, "utf-8")) as ServiceAccount;
  }

  return null;
}

export function getSacredSheetId(): string {
  return process.env.GOOGLE_SHEETS_ID?.trim() || DEFAULT_SACRED_SHEET_ID;
}

export function getSacredSheetRange(): string {
  return process.env.GOOGLE_SHEETS_RANGE?.trim() || "Sheet1!A:Z";
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    loadServiceAccount() ||
      process.env.GOOGLE_SHEETS_API_KEY?.trim() ||
      process.env.GOOGLE_SHEETS_PUBLISH_CSV_URL?.trim()
  );
}

/** Fetch raw rows from the sacred Google Sheet */
export async function fetchSacredSheetRows(): Promise<string[][]> {
  const sheetId = getSacredSheetId();
  const range = encodeURIComponent(getSacredSheetRange());

  const publishUrl = process.env.GOOGLE_SHEETS_PUBLISH_CSV_URL?.trim();
  if (publishUrl) {
    const res = await fetch(publishUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Published CSV fetch failed: ${res.status}`);
    const text = await res.text();
    return parseCsv(text);
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim();
  const sa = loadServiceAccount();

  let url: string;
  const headers: Record<string, string> = {};

  if (sa) {
    const token = await getServiceAccountToken(sa);
    url = `${SHEETS_API}/${sheetId}/values/${range}`;
    headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    url = `${SHEETS_API}/${sheetId}/values/${range}?key=${apiKey}`;
  } else {
    throw new Error(
      "Google Sheets not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEETS_API_KEY, or GOOGLE_SHEETS_PUBLISH_CSV_URL"
    );
  }

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets API failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

export function getUnderutilisingSheetId(): string {
  return (
    process.env.UNDERUTILISING_SHEET_ID?.trim() || DEFAULT_UNDERUTILISING_SHEET_ID
  );
}

export function getUnderutilisingSheetGid(): number {
  const raw = process.env.UNDERUTILISING_SHEET_GID?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_UNDERUTILISING_SHEET_GID;
}

export function getUnderutilisingSheetPublishUrl(): string {
  return (
    process.env.UNDERUTILISING_SHEET_PUBLISH_CSV_URL?.trim() ||
    DEFAULT_UNDERUTILISING_SHEET_PUBLISH_CSV_URL
  );
}

export function isUnderutilisingSheetConfigured(): boolean {
  return Boolean(getUnderutilisingSheetPublishUrl().trim());
}

async function resolveSheetTitleByGid(
  sheetId: string,
  gid: number,
  headers: Record<string, string>
): Promise<string> {
  const res = await fetch(
    `${SHEETS_API}/${sheetId}?fields=sheets(properties(sheetId,title))`,
    { headers, cache: "no-store" }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets metadata failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const match = data.sheets?.find((s) => s.properties?.sheetId === gid);
  const title = match?.properties?.title;
  if (!title) throw new Error(`Sheet tab gid ${gid} not found`);
  return title;
}

/** Fetch rows from an arbitrary Google Sheet tab (published CSV, service account, or API key) */
export async function fetchGoogleSheetRowsByGid(
  sheetId: string,
  gid: number,
  publishUrl?: string
): Promise<string[][]> {
  const csvUrl = (publishUrl ?? "").trim();
  if (csvUrl) {
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Published CSV fetch failed: ${res.status}`);
    return parseCsv(await res.text());
  }

  const sa = loadServiceAccount();
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim();
  const headers: Record<string, string> = {};
  let title: string;

  if (sa) {
    const token = await getServiceAccountToken(sa);
    headers.Authorization = `Bearer ${token}`;
    title = await resolveSheetTitleByGid(sheetId, gid, headers);
  } else if (apiKey) {
    title = await resolveSheetTitleByGid(sheetId, gid, {});
  } else {
    throw new Error(
      "Underutilising sheet not configured. Set UNDERUTILISING_SHEET_PUBLISH_CSV_URL or Google credentials."
    );
  }

  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A:Z`);
  let url: string;
  if (sa) {
    url = `${SHEETS_API}/${sheetId}/values/${range}`;
  } else {
    url = `${SHEETS_API}/${sheetId}/values/${range}?key=${apiKey}`;
  }

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets API failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

/** Minimal RFC4180-ish CSV parser for published sheet URLs */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((c) => c)) rows.push(row);
  }

  return rows;
}
