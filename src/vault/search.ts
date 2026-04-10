import fs from "fs";
import path from "path";
import { vaultPath } from "./helpers.js";
import { SEARCH_MAX_RESULTS, SEARCH_LINE_MAX } from "../config.js";

export interface SearchResult {
  file: string;
  line: string;
}

export function searchVault(query: string, limitTo?: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const searchRoot = limitTo
    ? path.join(vaultPath, "Projekte", limitTo)
    : vaultPath;

  function searchDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(full);
      } else if (entry.name.endsWith(".md")) {
        const lines = fs.readFileSync(full, "utf-8").split("\n");
        for (const line of lines) {
          if (line.toLowerCase().includes(lowerQuery) && line.trim()) {
            results.push({ file: path.relative(vaultPath, full), line: line.trim().slice(0, SEARCH_LINE_MAX) });
            break;
          }
        }
      }
    }
  }

  searchDir(searchRoot);
  return results.slice(0, SEARCH_MAX_RESULTS);
}
