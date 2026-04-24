// Filesystem-Implementation: Wrapper um vault/team.ts
//
// Der FS-Mode ist ein Minimal-Fallback fuer Setups ohne Postgres. Er speichert
// ausschliesslich Namen in der Vault-Datei — Companies, M:N-Zuordnungen und
// Kontakt-Log existieren nur im DB-Mode. Die neuen Felder werden hier mit
// Defaults (null / leeres Array) gefuellt, damit der TeamMember-Typ stimmig
// bleibt und die UI nicht mit undefined crasht.
import * as vault from "../workspace/team.js";
import type { TeamMember, TeamRepository } from "./types.js";

function emptyMember(name: string, id: string): TeamMember {
  return {
    id,
    name,
    role: null,
    email: null,
    phone: null,
    company: null,
    projectId: null,
    companyId: null,
    companyName: null,
    memberType: null,
    projects: [],
    contactLog: [],
    createdAt: "",
    updatedAt: "",
  };
}

export const fsTeam: TeamRepository = {
  async list() {
    return vault.listTeam().map((name, i) => emptyMember(name, String(i)));
  },

  async get(id) {
    const all = await this.list();
    return all.find((m) => m.id === id || m.name === id) ?? null;
  },

  async add(member) {
    const ok = vault.addTeamMember(member.name);
    if (!ok) throw new Error("Mitglied existiert bereits");
    const all = await this.list();
    return all.find((m) => m.name === member.name)!;
  },

  async update(_id, _updates) {
    // Filesystem speichert nur Namen — kein Update moeglich
    return null;
  },

  async remove(nameOrId) {
    return vault.removeTeamMember(nameOrId);
  },

  // Optionale Methoden fuer Migration 006 — im FS-Mode bewusst nicht unterstuetzt.
  // Caller testen auf Anwesenheit via ?. bzw. fangen false-Return ab.
  async assignToProject() {
    return false;
  },
  async unassignFromProject() {
    return false;
  },
  async updateProjectRole() {
    return false;
  },
  async appendLog() {
    return false;
  },
  async listCompanies() {
    return [];
  },
};
