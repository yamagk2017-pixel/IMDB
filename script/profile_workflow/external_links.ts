import {
  researchResultSchema,
  type ResearchResult,
} from "./schema.js";

type FetchLike = typeof fetch;
type LinkField = "calendar_url" | "ticketdive_url";
type CandidateOrigin = "generated" | "existing" | "official_page";

type Candidate = {
  url: string;
  origin: CandidateOrigin;
  evidenceUrl?: string;
};

type FetchedPage = {
  finalUrl: string;
  text: string;
};

const CALENDAR_NOT_FOUND =
  "calendar_url: 自動調査では確認可能な公式カレンダー／スケジュールURLを特定できなかったため、空欄としています。";
const TICKETDIVE_NOT_FOUND =
  "ticketdive_url: 自動調査では確認可能なTicketDiveアーティストページを特定できなかったため、空欄としています。";

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function extractPageLinks(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const pattern = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtmlAttribute(match[2]?.trim() ?? "");
    if (!raw || /^(?:javascript:|mailto:|tel:|#)/i.test(raw)) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      if (["http:", "https:"].includes(resolved.protocol)) {
        resolved.hash = "";
        urls.add(resolved.toString());
      }
    } catch {
      // 壊れたリンクは候補に含めない。
    }
  }
  return [...urls];
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function isTicketDiveArtistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return (
      ["ticketdive.com", "www.ticketdive.com"].includes(url.hostname) &&
      parts[0]?.toLowerCase() === "artist" &&
      Boolean(parts[1])
    );
  } catch {
    return false;
  }
}

function isCalendarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.hostname === "calendar.google.com" &&
      decodedPath.toLowerCase().includes("/calendar")
    ) {
      return true;
    }
    if (
      /(^|\.)timetreeapp\.com$/i.test(url.hostname) &&
      /^\/public_calendars\//i.test(decodedPath)
    ) {
      return true;
    }
    return /(?:^|[/_.-])(?:schedule|calendar|events?|live)(?:[/_.-]|$)|スケジュール|ライブ/i.test(
      `${decodedPath}${url.search}`,
    );
  } catch {
    return false;
  }
}

function isCrawlableOfficialPage(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return ![
      "x.com",
      "twitter.com",
      "instagram.com",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      "open.spotify.com",
      "ticketdive.com",
      "calendar.google.com",
      "timetreeapp.com",
    ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

async function fetchPage(
  value: string,
  fetchImpl: FetchLike,
): Promise<FetchedPage | null> {
  try {
    const response = await fetchImpl(value, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "IMDB-Profile-Workflow/1.0",
      },
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > 2_000_000) return null;
    return {
      finalUrl: response.url || value,
      text: (await response.text()).slice(0, 1_000_000),
    };
  } catch {
    return null;
  }
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    try {
      const normalized = new URL(candidate.url).toString();
      if (seen.has(normalized)) return false;
      candidate.url = normalized;
      seen.add(normalized);
      return true;
    } catch {
      return false;
    }
  });
}

function removeSourceUrl(result: ResearchResult, removedUrl: string): void {
  result.sources = result.sources.filter((source) => source.url !== removedUrl);
  for (const [field, urls] of Object.entries(result.field_evidence)) {
    const remaining = urls.filter((url) => url !== removedUrl);
    if (remaining.length) result.field_evidence[field] = remaining;
    else delete result.field_evidence[field];
  }
}

function clearLink(result: ResearchResult, field: LinkField): void {
  const oldUrl = result.external_links[field];
  result.external_links[field] = null;
  delete result.field_evidence[`external_links.${field}`];
  for (const source of result.sources) {
    source.supports = source.supports.filter(
      (supported) => supported !== `external_links.${field}`,
    );
  }
  result.sources = result.sources.filter((source) => source.supports.length > 0);
  if (oldUrl) removeSourceUrl(result, oldUrl);
}

function setLink(
  result: ResearchResult,
  field: LinkField,
  candidate: Candidate,
): boolean {
  clearLink(result, field);
  const evidenceUrl = candidate.evidenceUrl ?? candidate.url;
  let source = result.sources.find((item) => item.url === evidenceUrl);
  if (!source) {
    if (result.sources.length >= 20) return false;
    source = {
      url: evidenceUrl,
      title:
        field === "calendar_url"
          ? `${result.canonical_name_ja} 公式スケジュール`
          : `${result.canonical_name_ja} - TicketDive`,
      publisher:
        field === "calendar_url" ? result.canonical_name_ja : "TicketDive",
      accessed_at: new Date().toISOString().slice(0, 10),
      source_type:
        candidate.origin === "official_page" ? "official" : "platform",
      supports: [],
    };
    result.sources.push(source);
  }
  const evidenceKey = `external_links.${field}`;
  if (!source.supports.includes(evidenceKey)) source.supports.push(evidenceKey);
  result.field_evidence[evidenceKey] = [evidenceUrl];
  result.external_links[field] = candidate.url;
  result.warnings = result.warnings.filter(
    (warning) => !warning.startsWith(`${field}:`),
  );
  return true;
}

function addWarning(result: ResearchResult, warning: string): void {
  if (result.warnings.includes(warning)) return;
  if (result.warnings.length < 30) result.warnings.push(warning);
  else result.warnings[result.warnings.length - 1] = warning;
}

async function collectOfficialPageCandidates(
  result: ResearchResult,
  fetchImpl: FetchLike,
): Promise<Candidate[]> {
  const officialPages = uniqueCandidates(
    [
      result.external_links.website_url,
      ...result.sources
        .filter((source) => source.source_type === "official")
        .map((source) => source.url),
    ]
      .filter((url): url is string => Boolean(url))
      .filter(isCrawlableOfficialPage)
      .map((url) => ({ url, origin: "official_page" as const })),
  ).slice(0, 4);

  const candidates = await Promise.all(
    officialPages.map(async (page): Promise<Candidate[]> => {
      const fetched = await fetchPage(page.url, fetchImpl);
      if (!fetched) return [];
      return extractPageLinks(fetched.text, fetched.finalUrl)
        .filter((url) => isCalendarUrl(url) || isTicketDiveArtistUrl(url))
        .map((url) => ({
          url,
          origin: "official_page",
          evidenceUrl: page.url,
        }));
    }),
  );
  return uniqueCandidates(candidates.flat());
}

async function findCalendar(
  candidates: Candidate[],
  fetchImpl: FetchLike,
): Promise<Candidate | null> {
  const ranked = candidates
    .filter((candidate) => isCalendarUrl(candidate.url))
    .sort((left, right) => {
      const score = (candidate: Candidate) => {
        const platform = /calendar\.google\.com|timetreeapp\.com/i.test(
          candidate.url,
        );
        if (candidate.origin === "official_page" && platform) return 0;
        if (candidate.origin === "official_page") return 1;
        if (candidate.origin === "existing") return 2;
        return 3;
      };
      return score(left) - score(right);
    });

  for (const candidate of ranked) {
    if (
      candidate.origin === "official_page" &&
      /calendar\.google\.com|timetreeapp\.com/i.test(candidate.url)
    ) {
      return candidate;
    }
    const fetched = await fetchPage(candidate.url, fetchImpl);
    if (fetched) return { ...candidate, url: fetched.finalUrl };
  }
  return null;
}

async function findTicketDive(
  candidates: Candidate[],
  names: string[],
  fetchImpl: FetchLike,
): Promise<Candidate | null> {
  const normalizedNames = names.map(normalizedName).filter(Boolean);
  for (const candidate of candidates.filter((item) =>
    isTicketDiveArtistUrl(item.url),
  )) {
    const fetched = await fetchPage(candidate.url, fetchImpl);
    if (!fetched || !isTicketDiveArtistUrl(fetched.finalUrl)) continue;
    const titleText = [
      ...fetched.text.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi),
      ...fetched.text.matchAll(
        /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      ),
    ]
      .map((match) => match[1] ?? "")
      .join(" ");
    const pageText = normalizedName(titleText || fetched.text.slice(0, 100_000));
    if (
      normalizedNames.length > 0 &&
      !normalizedNames.some((name) => pageText.includes(name))
    ) {
      continue;
    }
    return { ...candidate, url: fetched.finalUrl };
  }
  return null;
}

export async function resolveResearchExternalLinks(input: {
  result: ResearchResult;
  requestedName: string;
  existingLinks?: Record<string, string>;
  fetchImpl?: FetchLike;
}): Promise<ResearchResult> {
  const result = structuredClone(input.result);
  const fetchImpl = input.fetchImpl ?? fetch;
  const discovered = await collectOfficialPageCandidates(result, fetchImpl);
  const existing = input.existingLinks ?? {};

  const calendarCandidates = uniqueCandidates([
    ...(result.external_links.calendar_url
      ? [{ url: result.external_links.calendar_url, origin: "generated" as const }]
      : []),
    ...["schedule", "calendar", "google_calendar"]
      .map((service) => existing[service])
      .filter((url): url is string => Boolean(url))
      .map((url) => ({ url, origin: "existing" as const })),
    ...discovered,
  ]);
  const ticketDiveCandidates = uniqueCandidates([
    ...(result.external_links.ticketdive_url
      ? [{ url: result.external_links.ticketdive_url, origin: "generated" as const }]
      : []),
    ...(existing.ticketdive
      ? [{ url: existing.ticketdive, origin: "existing" as const }]
      : []),
    ...discovered,
  ]);

  const calendar = await findCalendar(calendarCandidates, fetchImpl);
  if (!calendar || !setLink(result, "calendar_url", calendar)) {
    clearLink(result, "calendar_url");
    addWarning(result, CALENDAR_NOT_FOUND);
  }

  const ticketDive = await findTicketDive(
    ticketDiveCandidates,
    [input.requestedName, result.canonical_name_ja],
    fetchImpl,
  );
  if (!ticketDive || !setLink(result, "ticketdive_url", ticketDive)) {
    clearLink(result, "ticketdive_url");
    addWarning(result, TICKETDIVE_NOT_FOUND);
  }

  return researchResultSchema.parse(result);
}
