// ============================================================
// PATIO — KI-Freigabe und Dossiers
// ============================================================
//   GET   /api/ki/freigabe            → aktueller Stand (nur Verwaltung)
//   PATCH /api/ki/freigabe            → Hauptschalter, Personendaten-Stufe
//   PUT   /api/ki/freigabe/:projectId → Kategorien EINES Projekts
//   GET   /api/ki/dossier             → alle freigegebenen Akten
//   GET   /api/ki/dossier/:projectId  → eine Akte (auch als Vorschau)
//
// ── Warum das alles nur die Verwaltung darf ────────────────────────────────
//
// Weil es eine Datenschutz-Entscheidung fürs Büro ist, keine persönliche
// Einstellung. Wer freigibt, entscheidet über die Daten von Bauherren,
// ausführenden Firmen und Kollegen — nicht über seine eigenen.
//
// Auch das LESEN der Dossiers ist Verwaltungssache: eine Akte fasst zusammen,
// was in einem Projekt steht, und die Freigabe ist ausdrücklich unabhängig
// von der Projektzuordnung. Ohne diese Einschränkung wäre der Dossier-Abruf
// der Weg, auf dem jedes Konto an jedes freigegebene Projekt käme.
// ============================================================

import { Hono } from "hono";
import { dbKiFreigabe, KI_KATEGORIEN, type KiKategorie } from "../../data/db-ki-freigabe.js";
import { dossierFuerProjekt, alleDossiers } from "../../mcp/dossier.js";
import { adminMiddleware } from "../auth.js";
import type { AppEnv } from "../server.js";

export const kiFreigabeRoutes = new Hono<AppEnv>();

// Alles hier ist Verwaltungssache — siehe Kopfkommentar.
kiFreigabeRoutes.use("/ki/*", adminMiddleware);

kiFreigabeRoutes.get("/ki/freigabe", async (c) => {
  return c.json({ ...(await dbKiFreigabe.lesen()), kategorien: KI_KATEGORIEN });
});

kiFreigabeRoutes.patch("/ki/freigabe", async (c) => {
  let body: { aktiv?: boolean; personendaten?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  if (
    body.personendaten !== undefined &&
    !["keine", "namen-ohne-kontakt", "alle"].includes(String(body.personendaten))
  ) {
    return c.json({ error: `Unbekannte Personendaten-Stufe: "${String(body.personendaten)}"` }, 400);
  }
  return c.json(
    await dbKiFreigabe.kopfSchreiben({
      aktiv: body.aktiv,
      personendaten: body.personendaten as "keine" | "namen-ohne-kontakt" | "alle" | undefined,
    }),
  );
});

kiFreigabeRoutes.put("/ki/freigabe/:projectId", async (c) => {
  let body: { kategorien?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const roh = Array.isArray(body.kategorien) ? body.kategorien : [];
  // Eine unbekannte Kategorie wird abgewiesen, nicht stillschweigend
  // verworfen: sonst sieht die Oberfläche ein Häkchen, das nie gesetzt wurde.
  const unbekannt = roh.filter((k) => !(KI_KATEGORIEN as readonly unknown[]).includes(k));
  if (unbekannt.length > 0) {
    return c.json({ error: `Unbekannte Kategorie(n): ${unbekannt.map(String).join(", ")}` }, 400);
  }
  await dbKiFreigabe.projektSchreiben(c.req.param("projectId"), roh as KiKategorie[]);
  return c.json(await dbKiFreigabe.lesen());
});

// ── Die Akten selbst ────────────────────────────────────────────────────────

kiFreigabeRoutes.get("/ki/dossier", async (c) => {
  return c.json(await alleDossiers());
});

kiFreigabeRoutes.get("/ki/dossier/:projectId", async (c) => {
  const d = await dossierFuerProjekt(c.req.param("projectId"));
  // 404 auch bei „nicht freigegeben": eine eigene Fehlermeldung dafür würde
  // die Existenz des Projekts bestätigen.
  if (!d) return c.json({ error: "Kein Dossier — Projekt nicht freigegeben oder nicht vorhanden." }, 404);
  // Als Text, nicht als JSON: die Akte IST Markdown, und wer sie prüft, will
  // sie lesen und nicht entpacken.
  return c.text(d.text, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});
