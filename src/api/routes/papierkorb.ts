// ============================================================
// PATIO — Papierkorb (Migrationen 044 und 049)
// ============================================================
//   GET    /api/papierkorb                        → alles Geloeschte
//   POST   /api/papierkorb/:typ/:id/zurueckholen   → wiederherstellen
//   DELETE /api/papierkorb/:typ/:id                → endgueltig entfernen
//
// ── Wer sieht was ───────────────────────────────────────────────────────────
//
// Die Rechte sind dieselben wie ueberall sonst, mit EINER Ausnahme:
//
//   * Notizen, Aufgaben und Termine folgen der Projekt-Sichtbarkeit. Wer das
//     Projekt sehen darf, sieht auch, was daraus im Papierkorb liegt, und
//     kann es zurueckholen. Datensaetze ohne Projekt sind persoenlich — sie
//     erscheinen nur bei ihrem Verfasser.
//   * PROJEKTE bleiben Admin-Sache. Ein geloeschtes Projekt ist fuer seinen
//     Ersteller nicht mehr sichtbar; er koennte es also gar nicht auswaehlen.
//     Diese Routen liegen weiterhin unter `/api/projects/…` und sind dort
//     getestet; hier werden sie nur mit aufgelistet, damit der Papierkorb
//     eine Ansicht ist und nicht zwei.
//
// Das endgueltige Entfernen ist der einzige unumkehrbare Schritt und geht nur
// aus dem Papierkorb heraus — zwei bewusste Entscheidungen statt einer.
// ============================================================

import { Hono } from "hono";
import { noteRepo, taskRepo, terminRepo, projectRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import type { PapierkorbEintrag, PapierkorbFaehig } from "../../data/types.js";
import { emit } from "../events.js";

export const papierkorbRoutes = new Hono<AppEnv>();

/** Die drei Datenarten, die einen Papierkorb haben. Der Schluessel steht in
 *  der Adresse (`/papierkorb/notiz/…`) und ist zugleich die Bezeichnung in der
 *  Oberflaeche. */
const ARTEN = {
  notiz: { repo: () => noteRepo as PapierkorbFaehig, label: "Notiz", event: "note" as const },
  aufgabe: { repo: () => taskRepo as PapierkorbFaehig, label: "Aufgabe", event: "task" as const },
  termin: { repo: () => terminRepo as PapierkorbFaehig, label: "Termin", event: "termin" as const },
};
type Art = keyof typeof ARTEN;

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Persoenliche Datensaetze (ohne Projekt) sieht nur ihr Verfasser.
 *
 *  Das ist dieselbe Regel wie in den Listen selbst — ohne sie waere der
 *  Papierkorb der Weg, auf dem man die persoenlichen Notizen der Kollegen
 *  doch noch zu sehen bekommt. */
function sichtbar(e: PapierkorbEintrag, ctx: UserCtx): boolean {
  if (ctx.role === "admin") return true;
  if (e.projectName) return true; // ueber die Projekt-IDs bereits gefiltert
  return !!e.createdById && e.createdById === ctx.userId;
}

papierkorbRoutes.get("/papierkorb", async (c) => {
  const ctx = userCtx(c);
  const sichtbareProjekte = await getVisibleProjectIds(ctx);

  const eintraege: Array<PapierkorbEintrag & { typ: Art }> = [];
  for (const [typ, art] of Object.entries(ARTEN) as [Art, (typeof ARTEN)[Art]][]) {
    const liste = (await art.repo().listDeleted?.(sichtbareProjekte)) ?? [];
    for (const e of liste) {
      if (sichtbar(e, ctx)) eintraege.push({ ...e, typ });
    }
  }
  eintraege.sort((a, b) => b.geloeschtAm.localeCompare(a.geloeschtAm));

  // Projekte nur fuer Admins — siehe Kopfkommentar.
  const projekte = ctx.role === "admin" ? ((await projectRepo.listDeleted?.()) ?? []) : [];

  return c.json({ eintraege, projekte });
});

/** Holt den Eintrag und prueft, ob der Aufrufer ihn anfassen darf.
 *
 *  Bewusst ueber `listDeleted` und nicht ueber eine eigene Abfrage: damit
 *  entscheidet dieselbe Menge ueber die Rechte, die auch angezeigt wird. Wer
 *  einen Eintrag nicht sieht, kann ihn auch nicht zurueckholen. */
async function eintragMitRecht(c: {
  var: { userId: string | null; userRole: "admin" | "user" };
  req: { param: (k: string) => string };
}): Promise<{ art: (typeof ARTEN)[Art]; id: string; eintrag: PapierkorbEintrag } | { fehler: 400 | 403 | 404 }> {
  const typ = c.req.param("typ") as Art;
  const art = ARTEN[typ];
  if (!art) return { fehler: 400 };

  const ctx = userCtx(c);
  const sichtbareProjekte = await getVisibleProjectIds(ctx);
  const liste = (await art.repo().listDeleted?.(sichtbareProjekte)) ?? [];
  const eintrag = liste.find((e) => e.id === c.req.param("id"));
  if (!eintrag) return { fehler: 404 };
  if (!sichtbar(eintrag, ctx)) return { fehler: 403 };
  return { art, id: eintrag.id, eintrag };
}

papierkorbRoutes.post("/papierkorb/:typ/:id/zurueckholen", async (c) => {
  const res = await eintragMitRecht(c);
  if ("fehler" in res) {
    const texte = { 400: "Unbekannte Art", 403: "Kein Zugriff", 404: "Liegt nicht im Papierkorb" };
    return c.json({ error: texte[res.fehler] }, res.fehler);
  }
  const ok = await res.art.repo().restore?.(res.id);
  if (!ok) return c.json({ error: "Liegt nicht im Papierkorb" }, 404);
  emit({ type: res.art.event, action: "created", id: res.id }, { actorId: c.var.userId });
  return c.json({ ok: true });
});

papierkorbRoutes.delete("/papierkorb/:typ/:id", async (c) => {
  const res = await eintragMitRecht(c);
  if ("fehler" in res) {
    const texte = { 400: "Unbekannte Art", 403: "Kein Zugriff", 404: "Liegt nicht im Papierkorb" };
    return c.json({ error: texte[res.fehler] }, res.fehler);
  }
  // Der einzige unumkehrbare Schritt.
  const ok = await res.art.repo().purge?.(res.id);
  if (!ok) return c.json({ error: "Liegt nicht im Papierkorb" }, 404);
  return c.json({ ok: true });
});
