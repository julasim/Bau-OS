import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB } from "./helpers/acl-fixture.js";

// Type-Queries statt any.
type ProjectRepo = (typeof import("../src/data/index.js"))["projectRepo"];
type TaskRepo = (typeof import("../src/data/index.js"))["taskRepo"];
type GetDb = (typeof import("../src/db/client.js"))["getDb"];

// PERF-1: GET /projects lief als N+1 — list() lieferte die Namen, dann eine
// schwere getInfo()-Query (3 JOINs + 8 Subqueries) PRO Name. Ersetzt durch
// projectRepo.listInfos(): dieselbe SELECT-Liste fuer alle sichtbaren Projekte
// in EINER Query. Dieser Test sichert ab, dass das Ergebnis byte-identisch
// bleibt (sonst waere die Optimierung ein Regressionsrisiko).
describe.skipIf(!HAS_DB)("PERF-1 — projectRepo.listInfos == list()+getInfo()", () => {
  let projectRepo: ProjectRepo;
  let taskRepo: TaskRepo;
  let getDb: GetDb;
  const suffix = Date.now();
  // Absichtlich unsortiert, damit der Sortier-Vergleich etwas aussagt.
  const names = [`perf-b-${suffix}`, `perf-a-${suffix}`, `perf-c-${suffix}`];
  let ids: string[] = [];

  beforeAll(async () => {
    ({ projectRepo, taskRepo } = await import("../src/data/index.js"));
    ({ getDb } = await import("../src/db/client.js"));
    for (const n of names) await projectRepo.create(n, {});
    const infos = await Promise.all(names.map((n) => projectRepo.getInfo(n)));
    ids = infos.map((i) => i!.id);
    // An EINEM Projekt eine Aufgabe → openTasks=1. Damit prueft der Vergleich
    // echte, projektspezifische Aggregate (korrelierte Subquery pro Zeile),
    // nicht nur lauter Nullen.
    await taskRepo.save("PERF-1 Testaufgabe", names[0]);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const db = getDb();
    // Tasks haengen per ON DELETE CASCADE an den Projekten.
    await db`DELETE FROM projects WHERE id = ANY(${ids})`;
  });

  it("listInfos(ids) ist deep-equal zu list(ids).map(getInfo)", async () => {
    const viaInfos = await projectRepo.listInfos!(ids);
    const nm = await projectRepo.list(ids);
    const viaN1 = (await Promise.all(nm.map((n) => projectRepo.getInfo(n)))).filter(Boolean);
    expect(viaInfos).toEqual(viaN1);
  });

  it("Ergebnis ist nach Name sortiert", async () => {
    const infos = await projectRepo.listInfos!(ids);
    const gotNames = infos.map((i) => i.name);
    expect(gotNames).toEqual([...gotNames].sort());
  });

  it("Aggregate korrelieren pro Projekt (openTasks nur am richtigen Projekt)", async () => {
    const infos = await projectRepo.listInfos!(ids);
    const withTask = infos.find((i) => i.name === names[0]);
    const withoutTask = infos.find((i) => i.name === names[1]);
    expect(withTask?.openTasks).toBe(1);
    expect(withoutTask?.openTasks).toBe(0);
  });

  it("leeres visibleIds-Array → []", async () => {
    expect(await projectRepo.listInfos!([])).toEqual([]);
  });
});
