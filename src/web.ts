/**
 * Web-Utilities: Suche, Nachrichten und Seiteninhalt abrufen.
 * Kein externer API-Key noetig — nutzt DuckDuckGo HTML.
 */

import {
  FETCH_TIMEOUT_MS, WEB_MAX_RETRIES, MAX_RESPONSE_BYTES,
  WEB_CACHE_TTL_MS, WEB_CACHE_MAX,
} from "./config.js";

// Realistischer Browser User-Agent — DuckDuckGo blockt Bot-UAs
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface NewsResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date: string;
}

// ── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const searchCache = new Map<string, CacheEntry<SearchResult[]>>();
const newsCache = new Map<string, CacheEntry<NewsResult[]>>();
const pageCache = new Map<string, CacheEntry<string>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  // Limit Cache-Groesse
  if (cache.size > WEB_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, expires: Date.now() + WEB_CACHE_TTL_MS });
}

// ── Retry-Fetch ────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = WEB_MAX_RETRIES): Promise<Response> {
  const opts: RequestInit = {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
      "Accept-Encoding": "identity",  // Kein gzip — einfacher zu verarbeiten
      "DNT": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      ...(options.headers as Record<string, string>),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.ok) return resp;
      // Bei 429 (Rate Limit) oder 503 warten und retry
      if ((resp.status === 429 || resp.status === 503) && attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    } catch (err) {
      if (attempt >= retries) throw err;
      // Timeout oder Netzwerkfehler → retry mit Backoff
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error("Fetch fehlgeschlagen nach Retries");
}

// ── HTML → Markdown Konverter ──────────────────────────────────────────────

/** Entfernt nicht-inhaltliche HTML-Elemente */
function removeNonContent(html: string): string {
  return html
    // Script, Style, SVG komplett entfernen
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    // Navigation, Header, Footer, Sidebar entfernen
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    // Versteckte Elemente
    .replace(/<[^>]+hidden[^>]*>[\s\S]*?<\/[^>]+>/gi, "")
    .replace(/<[^>]+display:\s*none[^>]*>[\s\S]*?<\/[^>]+>/gi, "");
}

/** Dekodiert HTML-Entities */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&auml;/g, "ä").replace(/&Auml;/g, "Ä")
    .replace(/&ouml;/g, "ö").replace(/&Ouml;/g, "Ö")
    .replace(/&uuml;/g, "ü").replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß")
    .replace(/&euro;/g, "€")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
    .replace(/&copy;/g, "©").replace(/&reg;/g, "®")
    .replace(/&trade;/g, "™");
}

/** Konvertiert HTML in lesbares Markdown — bewahrt Struktur */
function htmlToMarkdown(html: string): string {
  let text = html;

  // Links extrahieren — [text](url) Format
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Ueberschriften
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
  text = text.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n\n**$1**\n\n");

  // Absaetze und Zeilenumbrueche
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");

  // Listen
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
  text = text.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  // Textformatierung
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  text = text.replace(/<(code)[^>]*>([\s\S]*?)<\/\1>/gi, "`$2`");

  // Tabellen — einfache Zeilen
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, "$1 | ");

  // Horizontale Linien
  text = text.replace(/<hr[^>]*\/?>/gi, "\n---\n");

  // Blockquote
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

  // Bilder — Alt-Text behalten
  text = text.replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, "[Bild: $1]");
  text = text.replace(/<img[^>]*>/gi, "");

  // Alle verbleibenden Tags entfernen
  text = text.replace(/<[^>]+>/g, "");

  // Entities dekodieren
  text = decodeEntities(text);

  // Whitespace bereinigen
  text = text
    .replace(/[ \t]+/g, " ")          // Mehrfach-Spaces → ein Space
    .replace(/\n[ \t]+/g, "\n")       // Einrueckung nach Newline entfernen
    .replace(/\n{4,}/g, "\n\n\n")     // Max 2 Leerzeilen
    .replace(/^\n+/, "")              // Fuehrende Leerzeilen
    .replace(/\n+$/, "")              // Trailing Leerzeilen
    .trim();

  return text;
}

/** Einfaches HTML-Stripping (fuer Snippets etc.) */
function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

// ── Content-Extraktion ─────────────────────────────────────────────────────

/**
 * Findet alle Vorkommen eines Tags und gibt den laengsten Inhalt zurueck.
 * Besser als einfaches Regex — nimmt den groessten Block statt den ersten.
 */
function findLargestBlock(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let largest = "";
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1].length > largest.length) {
      largest = match[1];
    }
  }
  return largest.length > 100 ? largest : null;
}

/** Extrahiert den Hauptinhalt einer HTML-Seite */
function extractMainContent(html: string): string {
  // Erst Non-Content entfernen
  const cleaned = removeNonContent(html);

  // 1. <article> — groessten Block nehmen
  const article = findLargestBlock(cleaned, "article");
  if (article) return htmlToMarkdown(article);

  // 2. <main>
  const main = findLargestBlock(cleaned, "main");
  if (main) return htmlToMarkdown(main);

  // 3. role="main" oder bekannte Content-IDs
  const roleMatch = cleaned.match(/<[^>]+role="main"[^>]*>([\s\S]*?)<\/\w+>/i);
  if (roleMatch && roleMatch[1].length > 100) return htmlToMarkdown(roleMatch[1]);

  const idPatterns = ["content", "main-content", "article", "post", "entry-content", "post-content", "article-body", "story-body"];
  for (const id of idPatterns) {
    const idMatch = cleaned.match(new RegExp(`<[^>]+id="${id}"[^>]*>([\\s\\S]*?)<\\/\\w+>`, "i"));
    if (idMatch && idMatch[1].length > 100) return htmlToMarkdown(idMatch[1]);
  }

  // 4. class-basierte Suche
  const classPatterns = ["article-content", "post-content", "entry-content", "story-body", "article-body", "content-body"];
  for (const cls of classPatterns) {
    const clsMatch = cleaned.match(new RegExp(`<[^>]+class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/\\w+>`, "i"));
    if (clsMatch && clsMatch[1].length > 100) return htmlToMarkdown(clsMatch[1]);
  }

  // 5. Fallback: Body → Markdown
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return htmlToMarkdown(bodyMatch[1]);

  return htmlToMarkdown(cleaned);
}

// ── DuckDuckGo Parser ─────────────────────────────────────────────────────

/** Parst DuckDuckGo HTML-Suchergebnisse */
function parseDdgResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Methode 1: result__a Links (klassisches DDG HTML)
  const blocks = html.split(/class="result\s/);
  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1];
    // DuckDuckGo wrapped URLs entpacken
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);

    const title = stripHtml(linkMatch[2]);
    if (!title || resultUrl.includes("duckduckgo.com")) continue;

    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[at]/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    results.push({ title, url: resultUrl, snippet });
  }

  // Methode 2: Fallback — Links mit /l/?uddg= Parameter
  if (results.length === 0) {
    const linkRegex = /href="\/l\/\?uddg=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
      const url = decodeURIComponent(match[1]);
      const title = stripHtml(match[2]);
      if (!title || url.includes("duckduckgo.com")) continue;
      results.push({ title, url, snippet: "" });
    }
  }

  return results;
}

// ── Websuche ───────────────────────────────────────────────────────────────

/** Websuche via DuckDuckGo HTML — Region Oesterreich */
export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const cacheKey = `search:${query}:${maxResults}`;
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=at-de&kp=-1`;

  const resp = await fetchWithRetry(url);
  const html = await resp.text();

  const results = parseDdgResults(html, maxResults);

  if (results.length > 0) {
    setCache(searchCache, cacheKey, results);
  }

  return results;
}

// ── Nachrichten-Suche ──────────────────────────────────────────────────────

/** Parst Google News RSS XML */
function parseGoogleNewsRss(xml: string, maxResults: number): NewsResult[] {
  const results: NewsResult[] = [];

  // <item> Blöcke extrahieren
  const items = xml.split(/<item>/);
  for (let i = 1; i < items.length && results.length < maxResults; i++) {
    const item = items[i];

    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);

    if (!titleMatch || !linkMatch) continue;

    const cleanCdata = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "");
    const title = stripHtml(cleanCdata(titleMatch[1]));
    const url = cleanCdata(linkMatch[1]).trim();
    const source = sourceMatch ? stripHtml(cleanCdata(sourceMatch[1])) : "";
    // Google News Description ist entity-encoded HTML — erst dekodieren, dann strippen
    // Format: &lt;a href="..."&gt;Titel&lt;/a&gt;&lt;font&gt;Quelle&lt;/font&gt;
    // Enthält kein echtes Snippet — nur Titel+Quelle nochmal. Daher leer lassen.
    const snippet = "";

    // Datum formatieren (z.B. "Thu, 10 Apr 2026 08:30:00 GMT" → "10.04.2026")
    let date = "";
    if (pubDateMatch) {
      try {
        const d = new Date(pubDateMatch[1].trim());
        if (!isNaN(d.getTime())) {
          date = d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
        }
      } catch { /* ignore */ }
    }

    if (title && url) {
      results.push({ title, url, snippet, source, date });
    }
  }

  return results;
}

/** Nachrichten-Suche via Google News RSS — Region Österreich, keine API nötig */
export async function newsSearch(query: string, maxResults = 5): Promise<NewsResult[]> {
  const cacheKey = `news:${query}:${maxResults}`;
  const cached = getCached(newsCache, cacheKey);
  if (cached) return cached;

  // Google News RSS — frei verfuegbar, kein API-Key, kein CAPTCHA
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=de&gl=AT&ceid=AT:de`;

  const resp = await fetchWithRetry(url);
  const xml = await resp.text();

  const results = parseGoogleNewsRss(xml, maxResults);

  if (results.length > 0) {
    setCache(newsCache, cacheKey, results);
  }

  return results;
}

// ── Webseite lesen ─────────────────────────────────────────────────────────

/** Webseite abrufen, Hauptinhalt extrahieren, als Markdown zurueckgeben */
export async function fetchPage(url: string, maxChars = 12000): Promise<string> {
  const cacheKey = `page:${url}`;
  const cached = getCached(pageCache, cacheKey);
  if (cached) return cached;

  // SSRF-Schutz: Private IPs blocken
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" ||
        hostname.startsWith("192.168.") || hostname.startsWith("10.") ||
        hostname.startsWith("172.16.") || hostname.startsWith("172.17.") ||
        hostname.startsWith("172.18.") || hostname.startsWith("172.19.") ||
        hostname.startsWith("172.2") || hostname.startsWith("172.30.") ||
        hostname.startsWith("172.31.") || hostname === "::1" ||
        hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      return "[Fehler: Zugriff auf interne/private Adressen nicht erlaubt]";
    }
  } catch {
    return `[Fehler: Ungültige URL: ${url}]`;
  }

  const resp = await fetchWithRetry(url);

  // Response-Groesse pruefen
  const contentLength = resp.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    return `[Fehler: Seite zu groß (${Math.round(Number(contentLength) / 1_000_000)} MB). Nur Seiten bis 5 MB werden gelesen.]`;
  }

  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
    return `[Kein Text-Inhalt: ${contentType}]`;
  }

  const html = await resp.text();

  // Groessen-Check nach Download
  if (html.length > MAX_RESPONSE_BYTES) {
    return `[Fehler: Seite zu groß (${Math.round(html.length / 1_000_000)} MB)]`;
  }

  // Bei Plain-Text direkt zurueckgeben
  if (contentType.includes("text/plain")) {
    const text = html.trim();
    const output = text.length > maxChars
      ? text.slice(0, maxChars) + `\n\n[... gekürzt, ${text.length - maxChars} Zeichen entfernt]`
      : text;
    setCache(pageCache, cacheKey, output);
    return output;
  }

  // HTML: Titel extrahieren
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "";

  // Meta-Description als Fallback
  const metaDesc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"[^>]*>/i);

  // Hauptinhalt extrahieren
  const content = extractMainContent(html);

  let output: string;
  if (!content || content.length < 50) {
    // Fallback: einfaches Stripping wenn Content-Extraktion zu wenig liefert
    const fallback = htmlToMarkdown(removeNonContent(html));
    const desc = metaDesc ? `\n\n> ${stripHtml(metaDesc[1])}\n` : "";
    output = title ? `# ${title}${desc}\n\n${fallback}` : fallback;
  } else {
    output = title ? `# ${title}\n\n${content}` : content;
  }

  const result = output.length > maxChars
    ? output.slice(0, maxChars) + `\n\n[... gekürzt, ${output.length - maxChars} Zeichen entfernt]`
    : output;

  setCache(pageCache, cacheKey, result);
  return result;
}
