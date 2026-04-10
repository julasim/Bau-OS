/**
 * Web-Utilities: Suche, Nachrichten und Seiteninhalt abrufen.
 * Kein externer API-Key noetig — nutzt DuckDuckGo HTML.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; Bau-OS/1.0; +https://github.com/julasim/Bau-OS)";
const FETCH_TIMEOUT = 12_000;
const MAX_RETRIES = 2;

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

// ── Retry-Fetch ────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = MAX_RETRIES): Promise<Response> {
  const opts: RequestInit = {
    ...options,
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "de-AT,de;q=0.9", ...options.headers as Record<string, string> },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.ok) return resp;
      // Bei 429 (Rate Limit) warten und retry
      if (resp.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    } catch (err) {
      if (attempt >= retries) throw err;
      // Timeout oder Netzwerkfehler → retry
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
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
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»");
}

/** Konvertiert HTML in lesbares Markdown — bewahrt Struktur */
function htmlToMarkdown(html: string): string {
  let text = html;

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

  // Tabellen — einfache Zeilen
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, "$1 | ");

  // Horizontale Linien
  text = text.replace(/<hr[^>]*\/?>/gi, "\n---\n");

  // Blockquote
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

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

/** Extrahiert den Hauptinhalt einer HTML-Seite */
function extractMainContent(html: string): string {
  // Erst Non-Content entfernen
  let cleaned = removeNonContent(html);

  // Nach <article> oder <main> suchen
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    return htmlToMarkdown(articleMatch[1]);
  }

  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) {
    return htmlToMarkdown(mainMatch[1]);
  }

  // Fallback: role="main" oder id="content"/"main-content"
  const roleMatch = cleaned.match(/<[^>]+role="main"[^>]*>([\s\S]*?)<\/\w+>/i);
  if (roleMatch) {
    return htmlToMarkdown(roleMatch[1]);
  }

  const contentMatch = cleaned.match(/<[^>]+id="(?:content|main-content|article|post)"[^>]*>([\s\S]*?)<\/\w+>/i);
  if (contentMatch) {
    return htmlToMarkdown(contentMatch[1]);
  }

  // Letzter Fallback: Body → Markdown
  const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return htmlToMarkdown(bodyMatch[1]);
  }

  return htmlToMarkdown(cleaned);
}

// ── Websuche ───────────────────────────────────────────────────────────────

/** Websuche via DuckDuckGo HTML — Region Oesterreich */
export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=at-de`;

  const resp = await fetchWithRetry(url);
  const html = await resp.text();

  const results: SearchResult[] = [];
  const blocks = html.split(/class="result\s/);

  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    // Titel + URL
    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1];
    // DuckDuckGo wrapped URLs entpacken
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);

    const title = stripHtml(linkMatch[2]);
    if (!title || resultUrl.includes("duckduckgo.com")) continue;

    // Snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[at]/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    results.push({ title, url: resultUrl, snippet });
  }

  return results;
}

// ── Nachrichten-Suche ──────────────────────────────────────────────────────

/** Nachrichten-Suche via DuckDuckGo — fokussiert auf aktuelle Meldungen */
export async function newsSearch(query: string, maxResults = 5): Promise<NewsResult[]> {
  // DuckDuckGo News-Suche (lite Version fuer stabiles Parsing)
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&iar=news&kl=at-de`;

  const resp = await fetchWithRetry(url);
  const html = await resp.text();

  const results: NewsResult[] = [];
  const blocks = html.split(/class="result\s/);

  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    // Titel + URL
    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1];
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]);

    const title = stripHtml(linkMatch[2]);
    if (!title || resultUrl.includes("duckduckgo.com")) continue;

    // Snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[at]/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";

    // Quelle (Domain extrahieren)
    let source = "";
    try {
      source = new URL(resultUrl).hostname.replace(/^www\./, "");
    } catch { /* ignore */ }

    // Datum (falls vorhanden)
    const dateMatch = block.match(/class="result__timestamp"[^>]*>([\s\S]*?)<\//) ||
                      block.match(/class="result__extras__url"[^>]*>[\s\S]*?(\d{1,2}[\./]\d{1,2}[\./]\d{2,4})/) ||
                      block.match(/>(\d{1,2}\.\s?\w+\.?\s?\d{4})</);
    const date = dateMatch ? stripHtml(dateMatch[1]) : "";

    results.push({ title, url: resultUrl, snippet, source, date });
  }

  return results;
}

// ── Webseite lesen ─────────────────────────────────────────────────────────

/** Webseite abrufen, Hauptinhalt extrahieren, als Markdown zurueckgeben */
export async function fetchPage(url: string, maxChars = 10000): Promise<string> {
  const resp = await fetchWithRetry(url);

  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return `[Kein Text-Inhalt: ${contentType}]`;
  }

  const html = await resp.text();

  // Bei Plain-Text direkt zurueckgeben
  if (contentType.includes("text/plain")) {
    const text = html.trim();
    return text.length > maxChars
      ? text.slice(0, maxChars) + `\n\n[... gekürzt, ${text.length - maxChars} Zeichen entfernt]`
      : text;
  }

  // HTML: Titel extrahieren
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : "";

  // Hauptinhalt extrahieren
  const content = extractMainContent(html);

  if (!content || content.length < 50) {
    // Fallback: einfaches Stripping wenn Content-Extraktion zu wenig liefert
    const fallback = htmlToMarkdown(removeNonContent(html));
    const output = title ? `# ${title}\n\n${fallback}` : fallback;
    return output.length > maxChars
      ? output.slice(0, maxChars) + `\n\n[... gekürzt, ${output.length - maxChars} Zeichen entfernt]`
      : output;
  }

  const output = title ? `# ${title}\n\n${content}` : content;
  return output.length > maxChars
    ? output.slice(0, maxChars) + `\n\n[... gekürzt, ${output.length - maxChars} Zeichen entfernt]`
    : output;
}
