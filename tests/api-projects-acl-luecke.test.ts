import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Sieben Unterrouten von /projects/:name prüften den Zugriff nicht.
//
// Gefunden am 2026-08-23 beim Einbau der Projektnummer, in genau der Datei,
// die dafür ohnehin angefasst wurde. Der Befund ist Altbestand, keine Folge
// dieser Arbeit.
//
// ── Warum es so lange unsichtbar war ────────────────────────────────────────
//
// Die Lücke steht direkt NEBEN dem richtigen Code. In `projects.ts` prüfen
// `POST /projects/:name/tasks` und `POST /projects/:name/termine` sauber mit
// `canSeeProjectByName` — ihre Geschwister `PATCH .../tasks` und
// `DELETE .../termine`, drei Zeilen weiter, nicht. Beim Lesen sieht die Datei
// bewacht aus, weil an der Stelle, an der man hinsieht, eine Prüfung steht.
//
// ── Was möglich war ─────────────────────────────────────────────────────────
//
// Alles nur mit einem gültigen Konto und dem Projektnamen — der Name genügt,
// eine ID braucht es nicht:
//
//   * den vollen Inhalt jeder Notiz aus jedem Projekt lesen,
//   * das komplette Projekt-Dossier als Markdown herunterladen,
//   * Aufgaben, Termine, Unterprojekte fremder Projekte auflisten,
//   * eine Aufgabe in einem fremden Projekt abhaken (schreibend),
//   * einen Termin in einem fremden Projekt löschen (schreibend).
//
// Diese Datei prüft für jede der sieben Routen, dass B nicht an A's Projekt
// kommt. Jede Prüfung war vor dem Fix rot.
describe.skipIf(!HAS_DB)("Projekt-Unterrouten: kein Zugriff ohne Recht", () => {
  let fx: AclFixture;
  const P = namensraum();
  let notizTitel: string;
  let aufgabenText: string;
  let terminText: string;

  beforeAll(async () => {
    fx = await setupAclFixture("aclluecke");

    // A legt in SEINEM Projekt an, was B gleich nicht sehen darf.
    notizTitel = `acl-notiz-${P}`;
    aufgabenText = `acl-aufgabe-${P}`;
    terminText = `acl-termin-${P}`;

    await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ content: `${notizTitel}\nGeheimer Inhalt ${P}`, project: fx.projectName }),
    });
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: aufgabenText, project: fx.projectName }),
    });
    await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "01.10.2026", text: terminText, project: fx.projectName }),
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM notes WHERE title LIKE ${"acl-notiz-" + P + "%"}`;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${"acl-aufgabe-" + P + "%"}`;
    await getDb()`DELETE FROM termine WHERE text LIKE ${"acl-termin-" + P + "%"}`;
    await fx.cleanup();
  });

  const alsB = (pfad: string, init: RequestInit = {}) =>
    fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}${pfad}`, {
      headers: init.body ? jsonHeader(fx.b.token) : authHeader(fx.b.token),
      ...init,
    });

  // ── Lesend ────────────────────────────────────────────────────────────────

  it("Notizliste eines fremden Projekts bleibt zu", async () => {
    expect((await alsB("/notes")).status).toBe(403);
  });

  it("der Inhalt einer fremden Notiz bleibt zu", async () => {
    // Die schwerste der sieben: hier ging nicht nur eine Liste hinaus,
    // sondern der volle Text.
    const res = await alsB(`/notes/${encodeURIComponent(notizTitel)}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("Geheimer Inhalt");
  });

  it("Aufgabenliste eines fremden Projekts bleibt zu", async () => {
    const res = await alsB("/tasks");
    expect(res.status).toBe(403);
  });

  it("Terminliste eines fremden Projekts bleibt zu", async () => {
    expect((await alsB("/termine")).status).toBe(403);
  });

  it("Unterprojekte eines fremden Projekts bleiben zu", async () => {
    expect((await alsB("/children")).status).toBe(403);
  });

  it("das Markdown-Dossier eines fremden Projekts bleibt zu", async () => {
    // Es enthält Stammdaten, Team, Aufgaben, Termine und den Notizindex —
    // also praktisch alles auf einmal.
    const res = await alsB("/export.md");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(aufgabenText);
  });

  // ── Schreibend ────────────────────────────────────────────────────────────

  it("eine Aufgabe im fremden Projekt lässt sich nicht abhaken", async () => {
    const res = await alsB("/tasks", { method: "PATCH", body: JSON.stringify({ text: aufgabenText }) });
    expect(res.status).toBe(403);

    // Und zwar wirklich nicht — der Statuscode allein sagt noch nicht, dass
    // nichts geschrieben wurde.
    const nachher = await fx.app.request(`/api/tasks?project=${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.a.token),
    });
    const liste = (await nachher.json()) as { text: string; status: string }[];
    expect(liste.find((t) => t.text === aufgabenText)?.status).not.toBe("done");
  });

  it("ein Termin im fremden Projekt lässt sich nicht löschen", async () => {
    const res = await alsB("/termine", { method: "DELETE", body: JSON.stringify({ text: terminText }) });
    expect(res.status).toBe(403);

    const nachher = await fx.app.request(`/api/termine?project=${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.a.token),
    });
    const liste = (await nachher.json()) as { text: string }[];
    expect(liste.some((t) => t.text === terminText)).toBe(true);
  });

  // ── Gegenprobe: der Berechtigte kommt weiterhin durch ─────────────────────

  it("A selbst kommt überall durch", async () => {
    // Ohne diese Gegenprobe wäre ein Fix, der schlicht alles sperrt, grün.
    const eigene = (pfad: string) =>
      fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}${pfad}`, {
        headers: authHeader(fx.a.token),
      });
    for (const pfad of ["/notes", "/tasks", "/termine", "/children", "/export.md"]) {
      expect((await eigene(pfad)).status, pfad).toBe(200);
    }
    expect((await eigene(`/notes/${encodeURIComponent(notizTitel)}`)).status).toBe(200);
  });
});
