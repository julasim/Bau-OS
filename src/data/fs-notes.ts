// Filesystem-Implementation: wrapped bestehende vault/notes.ts
import * as vault from "../workspace/notes.js";
import type { NoteRepository } from "./types.js";

export const fsNotes: NoteRepository = {
  async save(content, project) {
    return vault.saveNote(content, project);
  },
  async list(limit = 10) {
    return vault.listNotes(limit);
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
