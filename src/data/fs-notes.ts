// Filesystem-Implementation: wrapped bestehende vault/notes.ts
import fs from "fs";
import path from "path";
import { WORKSPACE_INBOX } from "../config.js";
import { workspacePath } from "../workspace/helpers.js";
import * as vault from "../workspace/notes.js";
import type { NoteRepository, NoteSummary } from "./types.js";

export const fsNotes: NoteRepository = {
  async save(content, project) {
    return vault.saveNote(content, project);
  },
  async list(limit = 10) {
    return vault.listNotes(limit);
  },
  async listDetailed(limit = 50): Promise<NoteSummary[]> {
    const inboxPath = path.join(workspacePath, WORKSPACE_INBOX);
    if (!fs.existsSync(inboxPath)) return [];
    try {
      return fs
        .readdirSync(inboxPath)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, limit)
        .map((f) => {
          const fp = path.join(inboxPath, f);
          const stat = fs.statSync(fp);
          return {
            title: f.replace(".md", ""),
            project: null,
            createdAt: stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            size: stat.size,
          };
        });
    } catch {
      return [];
    }
  },
  async read(nameOrPath) {
    return vault.readNote(nameOrPath);
  },
  async append(nameOrPath, content) {
    return vault.appendToNote(nameOrPath, content);
  },
  async update(nameOrPath, content) {
    return vault.updateNote(nameOrPath, content);
  },
  async delete(nameOrPath) {
    return vault.deleteNote(nameOrPath);
  },
};
