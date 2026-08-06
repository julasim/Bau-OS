import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, jsonHeader, type AclFixture, type FixtureUser } from "./helpers/acl-fixture.js";

// Der Live-Kanal (SSE) war die letzte Stelle im System ohne Rechtefilter:
// `emit()` schrieb JEDES Ereignis an JEDEN verbundenen Client, und das Ereignis
// trug ein freies `data`-Feld. Das Einmal-Ticket authentifiziert nur — es sagt,
// wer verbunden ist, nicht was er sehen darf.
//
// Warum die Verteil-Logik hier direkt geprueft wird und nicht ueber eine echte
// EventSource: ein SSE-Stream endet nicht von selbst, `app.request()` wuerde auf
// den Response-Body warten. Der Test setzt deshalb eine Stufe tiefer an —
// `subscribe()` + `emit()` ohne HTTP. Das ist zugleich aussagekraeftiger, weil
// genau die Filterung geprueft wird und nicht das Stream-Handling drumherum.
// Den Sichtbarkeits-Kontext baut der Test NICHT von Hand, sondern ueber
// `resolveScope()` aus der Route — sonst wuerde er eine eigene ACL-Meinung
// testen statt der echten.
type EventsRoute = typeof import("../src/api/routes/events.js");
type EventBus = typeof import("../src/api/events.js");
type DataEvent = import("../src/api/events.js").DataEvent;
type EventScope = import("../src/api/events.js").EventScope;
type ProjectRepo = (typeof import("../src/data/index.js"))["projectRepo"];

describe.skipIf(!HAS_DB)("API — Live-Kanal: Ereignisse und Rechte", () => {
  let fx: AclFixture;
  let bus: EventBus;
  let resolveScope: EventsRoute["resolveScope"];
  let projectRepo: ProjectRepo;

  const STAMP = Date.now();

  // Sammelt alles, was ein Abonnent mit dem Scope dieses Nutzers bekaeme.
  // Rueckgabe: die empfangenen Ereignisse + unsubscribe.
  async function listenAs(u: FixtureUser): Promise<{ got: DataEvent[]; scope: EventScope; stop: () => void }> {
    const resolved = await resolveScope({ userId: u.id, role: u.role });
    const scope: EventScope = { userId: u.id, ...resolved };
    const got: DataEvent[] = [];
    const stop = bus.subscribe((e) => got.push(e), scope);
    return { got, scope, stop };
  }

  // Die HTTP-Routen loesen den Projektnamen fuer das Ereignis asynchron auf
  // (emitForProjectName ist fire-and-forget). Ein Tick reicht nicht — der
  // DB-Roundtrip braucht echte Zeit.
  const settle = () => new Promise((r) => setTimeout(r, 250));

  beforeAll(async () => {
    // Beide Konten bekommen das Geld-Recht: diese Suite misst die PROJEKT-Rechte,
    // nicht das Geld-Recht (das hat eine eigene Suite). Ohne diese Zeile
    // scheiterte sie am falschen Grund.
    fx = await setupAclFixture("ev", { geldRecht: true });
    bus = await import("../src/api/events.js");
    ({ resolveScope } = await import("../src/api/routes/events.js"));
    ({ projectRepo } = await import("../src/data/index.js"));
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    await db`DELETE FROM tasks WHERE text LIKE ${"%" + STAMP + "%"}`;
    await fx.cleanup();
  });

  // ── Sichtbarkeits-Kontext ────────────────────────────────────────────────
  // Vorbedingung fuer alles Weitere. Waere B's Scope leer oder "alles", wuerde
  // der eigentliche Confinement-Test nichts beweisen.
  it("baut den Scope aus den sichtbaren Projekten, Admin bleibt ungefiltert", async () => {
    const a = await resolveScope({ userId: fx.a.id, role: fx.a.role });
    const b = await resolveScope({ userId: fx.b.id, role: fx.b.role });
    const admin = await resolveScope({ userId: fx.admin.id, role: fx.admin.role });

    expect(a.unrestricted).toBe(false);
    expect(a.projectIds.has(fx.projectId)).toBe(true);
    expect(a.projectIds.has(fx.projectBId)).toBe(false);

    expect(b.unrestricted).toBe(false);
    expect(b.projectIds.has(fx.projectBId)).toBe(true);
    expect(b.projectIds.has(fx.projectId)).toBe(false);

    expect(admin.unrestricted).toBe(true);
  });

  // Die Rolle wird bei jeder Aufloesung frisch aus der DB gelesen. Ein Ticket
  // (oder ein altes JWT), das "admin" behauptet, darf einen herabgestuften
  // Admin nicht wieder zum Vollempfaenger machen.
  it("Rolle kommt aus der DB, nicht aus dem Ticket", async () => {
    const gelogen = await resolveScope({ userId: fx.b.id, role: "admin" });
    expect(gelogen.unrestricted).toBe(false);
    expect(gelogen.projectIds.has(fx.projectId)).toBe(false);
  });

  // ── Stufe 2: der Kern ────────────────────────────────────────────────────
  it("Confinement: Fremder (B) bekommt kein Ereignis aus A's Projekt", async () => {
    const a = await listenAs(fx.a);
    const b = await listenAs(fx.b);
    const admin = await listenAs(fx.admin);
    try {
      bus.emit({ type: "invoice", action: "created", id: "inv-1", projectId: fx.projectId });
      expect(b.got).toHaveLength(0);
      expect(a.got).toHaveLength(1);
      expect(admin.got).toHaveLength(1);
    } finally {
      a.stop();
      b.stop();
      admin.stop();
    }
  });

  it("das eigene Projekt kommt weiterhin an (Filter sperrt nicht generell aus)", async () => {
    const b = await listenAs(fx.b);
    try {
      bus.emit({ type: "task", action: "created", id: "t-1", projectId: fx.projectBId });
      expect(b.got.map((e) => e.projectId)).toEqual([fx.projectBId]);
    } finally {
      b.stop();
    }
  });

  // ── Falle 1: Ereignisse ohne Projektbezug ────────────────────────────────
  it("projektloses Ereignis: nur Admin und Ausloeser", async () => {
    const a = await listenAs(fx.a);
    const b = await listenAs(fx.b);
    const admin = await listenAs(fx.admin);
    try {
      // Ohne Ausloeser-Angabe: nur der Admin.
      bus.emit({ type: "team", action: "created", id: "m-1" });
      expect(admin.got).toHaveLength(1);
      expect(a.got).toHaveLength(0);
      expect(b.got).toHaveLength(0);

      // Mit Ausloeser B: B bekommt sein eigenes Ereignis zurueck, A weiterhin nicht.
      bus.emit({ type: "team", action: "updated", id: "m-1" }, { actorId: fx.b.id });
      expect(b.got).toHaveLength(1);
      expect(a.got).toHaveLength(0);
      expect(admin.got).toHaveLength(2);
    } finally {
      a.stop();
      b.stop();
      admin.stop();
    }
  });

  // Der Ausloeser darf nur der Ausloeser sein — nicht "irgendwer mit gesetzter
  // actorId". Sonst wuerde jede fremde Aenderung an alle gehen.
  it("Ausloeser-Regel greift nicht fuer Dritte", async () => {
    const b = await listenAs(fx.b);
    try {
      bus.emit({ type: "note", action: "updated", id: "n-1" }, { actorId: fx.a.id });
      bus.emit({ type: "note", action: "updated", id: "n-2", projectId: fx.projectId }, { actorId: fx.a.id });
      expect(b.got).toHaveLength(0);
    } finally {
      b.stop();
    }
  });

  // ── Falle 2: Sichtbarkeit aendert sich waehrend der Verbindung ───────────
  // Der Event-Bus haelt die Referenz auf das Scope-Objekt; die Route frischt es
  // periodisch AN ORT UND STELLE auf. Dieser Vertrag wird hier festgenagelt —
  // ohne ihn liefe die Auffrischung ins Leere und der Scope waere fuer die
  // gesamte (u.U. tagelange) Verbindungsdauer eingefroren.
  it("Auffrischung des Scope wirkt auf eine bereits offene Verbindung", async () => {
    const b = await listenAs(fx.b);
    try {
      bus.emit({ type: "task", action: "created", id: "t-2", projectId: fx.projectId });
      expect(b.got).toHaveLength(0);

      // B bekommt Zugriff auf A's Projekt — wie es die Route alle 15 Sekunden tut.
      await projectRepo.grantAccess!(fx.projectId, fx.b.id);
      const fresh = await resolveScope({ userId: fx.b.id, role: fx.b.role });
      b.scope.unrestricted = fresh.unrestricted;
      b.scope.projectIds = fresh.projectIds;

      bus.emit({ type: "task", action: "updated", id: "t-3", projectId: fx.projectId });
      expect(b.got.map((e) => e.id)).toEqual(["t-3"]);

      // ... und wieder entzogen: der Kanal schliesst sich beim naechsten Refresh.
      await projectRepo.revokeAccess!(fx.projectId, fx.b.id);
      const wieder = await resolveScope({ userId: fx.b.id, role: fx.b.role });
      b.scope.unrestricted = wieder.unrestricted;
      b.scope.projectIds = wieder.projectIds;

      bus.emit({ type: "task", action: "deleted", id: "t-4", projectId: fx.projectId });
      expect(b.got.map((e) => e.id)).toEqual(["t-3"]);
    } finally {
      b.stop();
    }
  });

  // ── Stufe 1: keine Nutzdaten mehr im Ereignis ────────────────────────────
  it("das Ereignis traegt nur Referenzen, keinen Inhalt", async () => {
    const admin = await listenAs(fx.admin);
    try {
      bus.emit({ type: "invoice", action: "created", id: "inv-2", projectId: fx.projectId });
      const e = admin.got[0]!;
      expect(Object.keys(e).sort()).toEqual(["action", "id", "projectId", "timestamp", "type"]);
      // Die beiden Felder, ueber die frueher Inhalte abfliessen konnten.
      expect(e).not.toHaveProperty("data");
      expect(e).not.toHaveProperty("project");
    } finally {
      admin.stop();
    }
  });

  // Zustell-Angaben sind kein Payload: `actorId` darf die Leitung nie sehen,
  // sonst waere die Nutzer-UUID des Ausloesers bei jedem Ereignis mit dabei.
  it("actorId geht nicht ueber die Leitung", async () => {
    const admin = await listenAs(fx.admin);
    try {
      bus.emit({ type: "team", action: "updated", id: "m-2" }, { actorId: fx.a.id });
      expect(admin.got[0]).not.toHaveProperty("actorId");
    } finally {
      admin.stop();
    }
  });

  // ── Ende-zu-Ende ueber die echten Routen ─────────────────────────────────
  // Beweist, dass die emit-Aufrufe in den Routen die Projekt-UUID auch wirklich
  // mitgeben — ein Ereignis ohne projectId waere sonst still nur fuer Admins
  // sichtbar und der Fehler faellt nirgends auf.
  it("POST /api/tasks in A's Projekt erreicht A und Admin, nicht B", async () => {
    const a = await listenAs(fx.a);
    const b = await listenAs(fx.b);
    const admin = await listenAs(fx.admin);
    try {
      const res = await fx.app.request("/api/tasks", {
        method: "POST",
        // jsonHeader ist eine FUNKTION (tests/helpers/acl-fixture.ts) — ein
        // Spread davon ergibt {} und der Request ginge ohne Content-Type raus.
        headers: jsonHeader(fx.a.token),
        body: JSON.stringify({ text: `Statikpruefung ${STAMP}`, project: fx.projectName }),
      });
      expect(res.status).toBe(201);
      await settle();

      expect(b.got).toHaveLength(0);
      expect(a.got).toHaveLength(1);
      expect(a.got[0]).toMatchObject({ type: "task", action: "created", projectId: fx.projectId });
      expect(admin.got).toHaveLength(1);
    } finally {
      a.stop();
      b.stop();
      admin.stop();
    }
  });

  // Rechnungsbetraege sind der Fall, der den Befund ausgeloest hat.
  it("POST einer Teilrechnung erreicht B nicht", async () => {
    const b = await listenAs(fx.b);
    const admin = await listenAs(fx.admin);
    try {
      const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/invoices`, {
        method: "POST",
        headers: jsonHeader(fx.a.token),
        body: JSON.stringify({ betrag: 48250.75, status: "gestellt", nummer: `R-${STAMP}` }),
      });
      expect(res.status).toBe(200);
      await settle();

      expect(b.got).toHaveLength(0);
      expect(admin.got).toHaveLength(1);
      expect(admin.got[0]).toMatchObject({ type: "invoice", action: "created", projectId: fx.projectId });
      // Auch beim Admin steht der Betrag nicht im Ereignis.
      expect(JSON.stringify(admin.got[0])).not.toContain("48250");
    } finally {
      b.stop();
      admin.stop();
    }
  });

  // ── Ticket: authentifiziert UND traegt die Identitaet ────────────────────
  // Ohne die Rolle im Ticket haette die SSE-Route beim Verbindungsaufbau gar
  // keine Identitaet: die authMiddleware winkt bei gueltigem Ticket durch,
  // ohne userId/userRole zu setzen.
  it("Ticket transportiert Nutzer und Rolle und ist einmalig", async () => {
    const { createTicket, consumeTicket } = await import("../src/api/sse-tickets.js");
    const t = createTicket({ userId: fx.b.id, role: "user" });
    expect(consumeTicket(t)).toEqual({ userId: fx.b.id, role: "user" });
    expect(consumeTicket(t)).toBeNull();
  });

  it("POST /api/events/ticket liefert ein einloesbares Ticket, GET /api/events ohne alles → 401", async () => {
    const res = await fx.app.request("/api/events/ticket", { method: "POST", headers: jsonHeader(fx.b.token) });
    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    expect(typeof ticket).toBe("string");

    const { peekTicket } = await import("../src/api/sse-tickets.js");
    expect(peekTicket(ticket)).toBe(true);

    expect((await fx.app.request("/api/events")).status).toBe(401);
    expect((await fx.app.request("/api/events?ticket=gibtsnicht")).status).toBe(401);
  });
});
