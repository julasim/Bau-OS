// Filesystem-Implementation: wrapped bestehende vault/termine.ts
import * as vault from "../vault/termine.js";
import type { Termin, TerminRepository } from "./types.js";

export const fsTermine: TerminRepository = {
  async save(datum, text, uhrzeit, project) {
    return vault.saveTermin(datum, text, uhrzeit, project) as Termin | string;
  },
  async list(project) {
    return vault.listTermine(project);
  },
  async get(id, project) {
    return vault.getTermin(id, project);
  },
  async update(id, updates, project) {
    return vault.updateTermin(id, updates, project);
  },
  async delete(textOrId, project) {
    return vault.deleteTermin(textOrId, project);
  },
};
