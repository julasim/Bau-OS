// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Die Fehlerklasse der Oberfläche — und der 401, der zu breit griff.
//
// ── Was hier festgehalten wird ─────────────────────────────────────────────
//
//  1. Ein Serverfehler kommt als `ApiError` MIT Statuscode an. Vorher war es
//     ein generisches `Error`, und keine Ansicht konnte 409 von 500
//     unterscheiden — die Folge war überall dieselbe: bei einem abgelehnten
//     Speichern wurde neu geladen und die Eingabe dabei verworfen.
//  2. Bei einem Konflikt sind die Felder dabei, die der Server ausdrücklich
//     mitschickt (`konflikt`, `aktuell`, `erwarteteRev`, `aktuelleRev`).
//  3. ⚠ Ein 401 **beim Anmelden** lädt die Seite NICHT neu. Der Zweig griff
//     auch für `POST /auth/login`; bei falschem Passwort ersetzte
//     `window.location.href` das Dokument, und der Nutzer sah ein leeres
//     Formular ohne jede Meldung.
//  4. Ein 401 auf jeder anderen Route bleibt, was er ist: Sitzung abgelaufen.
//  5. Eine 204-Antwort ist kein Fehler. Zwei Löschrouten antworten ohne
//     Inhalt; die Oberfläche versuchte trotzdem, einen zu lesen, und meldete
//     einen Fehler, obwohl das Löschen gelungen war.
describe("api.ts — Fehler kommen mit Statuscode an", () => {
  let umgeleitetNach: string | null = null;
  let gespeicherterToken: string | null = "test-token";

  beforeEach(async () => {
    vi.resetModules();
    umgeleitetNach = null;
    gespeicherterToken = "test-token";
    vi.stubGlobal("localStorage", {
      getItem: () => gespeicherterToken,
      setItem: () => {},
      removeItem: () => {
        gespeicherterToken = null;
      },
    });
    // `window.location.href` ist in happy-dom schreibbar, die Navigation
    // findet aber nicht statt — genau das brauchen wir hier.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return "http://localhost/";
        },
        set href(wert: string) {
          umgeleitetNach = wert;
        },
      },
    });
  });

  function antwort(status: number, koerper: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status < 400,
        status,
        json: async () => koerper,
      })),
    );
  }

  it("ein 400 wird zum ApiError mit Statuscode", async () => {
    const { api, ApiError } = await import("../../web/src/api");
    antwort(400, { error: "Datum fehlt" });
    await expect(api.post("/termine", {})).rejects.toThrowError(ApiError);
    await expect(api.post("/termine", {})).rejects.toMatchObject({ status: 400, message: "Datum fehlt" });
  });

  it("ein 409 bringt den aktuellen Stand mit", async () => {
    const { api, ApiError } = await import("../../web/src/api");
    antwort(409, {
      error: "Jemand anderes hat gespeichert",
      konflikt: true,
      aktuell: { id: "1", text: "neuer Stand" },
      erwarteteRev: 3,
      aktuelleRev: 4,
    });
    try {
      await api.put("/tasks/1", {});
      expect.unreachable("kein Fehler geworfen");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const f = e as InstanceType<typeof ApiError>;
      expect(f.istKonflikt).toBe(true);
      expect(f.aktuelleRev).toBe(4);
      expect(f.erwarteteRev).toBe(3);
      expect(f.aktuell).toEqual({ id: "1", text: "neuer Stand" });
    }
  });

  it("ein 401 beim ANMELDEN lädt die Seite nicht neu", async () => {
    // ⚠ Der Kern: Sonst ersetzt der Browser das Dokument, `LoginView`
    // montiert frisch, und die Meldung „Benutzername oder Passwort falsch"
    // ist weg, bevor jemand sie lesen kann.
    const { api, ApiError } = await import("../../web/src/api");
    antwort(401, { error: "Benutzername oder Passwort falsch" });
    await expect(api.post("/auth/login", { username: "x", password: "y" })).rejects.toThrowError(ApiError);
    expect(umgeleitetNach, "die Anmeldeseite wurde neu geladen").toBeNull();
    expect(gespeicherterToken, "der Token wurde beim Anmeldeversuch gelöscht").not.toBeNull();
  });

  it("ein 401 auf jeder anderen Route meldet ab", async () => {
    // Die Gegenrichtung: Der Ausschluss darf nur den Anmeldeweg treffen.
    // `/auth/me` liefert 401 bei abgelaufener Sitzung — dort muss der Zweig
    // greifen, sonst arbeitet jemand auf einer toten Sitzung weiter.
    const { api } = await import("../../web/src/api");
    antwort(401, { error: "Nicht autorisiert" });
    await expect(api.get("/auth/me")).rejects.toThrow();
    expect(umgeleitetNach).toBe("/login");
    expect(gespeicherterToken).toBeNull();
  });

  it("eine 204-Antwort ist kein Fehler", async () => {
    // `DELETE /projects/:name` und `/endgueltig` antworten ohne Inhalt.
    // `res.json()` warf darauf „Unexpected end of JSON input" — das Löschen
    // gelang, und die Oberfläche meldete trotzdem einen Fehler.
    const { api } = await import("../../web/src/api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      })),
    );
    await expect(api.delete("/projects/Muster")).resolves.toBeUndefined();
  });
});
