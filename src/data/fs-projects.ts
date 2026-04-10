// Filesystem-Implementation: wrapped bestehende vault/projects.ts
import * as vault from "../vault/projects.js";
import type { ProjectRepository } from "./types.js";

export const fsProjects: ProjectRepository = {
  async list() {
    return vault.listProjects();
  },
  async getInfo(name) {
    return vault.getProjectInfo(name);
  },
  async listNotes(name) {
    return vault.listProjectNotes(name);
  },
  async readNote(project, noteName) {
    return vault.readProjectNote(project, noteName);
  },
};
