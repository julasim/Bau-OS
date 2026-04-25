// Filesystem-Implementation: wrapped bestehende vault/projects.ts
//
// Hinweis: Stammdaten (projektnummer, bauherr, ...) gibt es im FS-Mode nicht —
// das FS-Schema ist bewusst einfach gehalten (nur Notizen-Ordner + README).
// Wer Stammdaten will, muss DB-Mode nutzen. Der FS-Mode bleibt als Fallback
// fuer Setups ohne Postgres erhalten.
import * as vault from "../workspace/projects.js";
import type { ProjectCreateOptions, ProjectRepository } from "./types.js";

export const fsProjects: ProjectRepository = {
  async list() {
    // FS-Mode hat keine ACL — Filter ist no-op, alles wird zurueckgegeben.
    return vault.listProjects();
  },
  async getInfo(name) {
    const info = await vault.getProjectInfo(name);
    if (!info) return null;
    // Die neuen Stammdaten-Felder im Project-Typ werden im FS-Mode einfach
    // mit null geliefert — Typen-Kompatibilitaet ohne Schema-Aenderung im FS.
    return {
      ...info,
      projektnummer: null,
      bauherr: null,
      standort: null,
      projektart: null,
      nutzung: null,
      phase: null,
      startDate: null,
      endDate: null,
      files: 0,
    };
  },
  async listNotes(name) {
    return vault.listProjectNotes(name);
  },
  async readNote(project, noteName) {
    return vault.readProjectNote(project, noteName);
  },
  async create(name, options) {
    // Im FS-Mode gibt es nur description — Stammdaten werden ignoriert.
    // Bei einem Objekt-Patch bauen wir description aus vorhandenen Feldern,
    // damit die Infos wenigstens in README.md landen.
    if (typeof options === "string" || options === null || options === undefined) {
      return vault.createProject(name, options ?? undefined);
    }
    const opts = options as ProjectCreateOptions;
    const stammBlock = [
      ["Projektnummer", opts.projektnummer],
      ["Bauherr", opts.bauherr],
      ["Standort", opts.standort],
      ["Projektart", opts.projektart],
      ["Nutzung", opts.nutzung],
      ["Phase", opts.phase],
    ]
      .filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const free = opts.description?.trim() ?? "";
    const combined = stammBlock && free ? `${stammBlock}\n\n${free}` : stammBlock || free || undefined;
    return vault.createProject(name, combined);
  },
  async update() {
    // FS-Mode unterstuetzt keine Stammdaten-Updates — die Infos leben nur
    // in README.md, und ein strukturiertes Patch-Modell waere brittle.
    // Gibt false zurueck, damit Caller sehen koennen: hat nicht funktioniert.
    return false;
  },
  async rename() {
    // FS-Mode: kein sicheres Rename, weil Ordner-Pfade ueberall zu Hardcoded-
    // Referenzen werden. User muss in DB-Mode umsteigen oder manuell arbeiten.
    return "invalid" as const;
  },
  async delete(name) {
    return vault.deleteProject(name);
  },
  // ACL ist ein DB-Konzept. FS-Mode hat keine User-Verwaltung — alle Methoden
  // geben Defaults zurueck, die "kein Filter, alle sehen alles" bedeuten.
  async listAccess() {
    return [];
  },
  async grantAccess() {
    return false;
  },
  async revokeAccess() {
    return false;
  },
  async listVisibleProjectIds() {
    return [];
  },
};
