// Filesystem-Implementation: Wrapper um vault/team.ts
import * as vault from "../workspace/team.js";
import type { TeamMember, TeamRepository } from "./types.js";

export const fsTeam: TeamRepository = {
  async list() {
    return vault.listTeam().map((name, i) => ({
      id: String(i),
      name,
      role: null,
      email: null,
      phone: null,
      company: null,
      projectId: null,
      createdAt: "",
      updatedAt: "",
    }));
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
};
