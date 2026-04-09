/**
 * Web-Utilities: Suche und Seiteninhalt abrufen.
 * Kein externer API-Key noetig — nutzt DuckDuckGo HTML.
 */

const USER_AGENT = "Bau-OS/1.0 (KI-Assistent)";
const FETCH_TIMEOUT = 10_000;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** HTML-Tags und ueberflüssige Leerzeichen entfernen */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Websuche via DuckDuckGo HTML (kein API-Key noetig) */
export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });

  if (!resp.ok) throw new Error(`DuckDuckGo HTTP ${resp.status}`);
  const html = await resp.text();

  const results: SearchResult[] = [];
  // DuckDuckGo HTML: jedes Ergebnis ist in <div class="result">
  const blocks = html.split(/class="result\s/);

  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];

    // Titel + URL
    const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    let resultUrl = linkMatch[1];
    // DuckDuckGo wrapped URLs: //duckduckgo.com/l/?uddg=...
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

/** Webseite abrufen und als bereinigten Text zurueckgeben */
export async function fetchPage(url: string, maxChars = 8000): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status} von ${url}`);

  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return `[Kein Text-Inhalt: ${contentType}]`;
  }

  const html = await resp.text();
  const text = stripHtml(html);

  if (text.length > maxChars) {
    return text.slice(0, maxChars) + `\n\n[... gekuerzt, ${text.length - maxChars} Zeichen entfernt]`;
  }

  return text;
}
