// ============================================================
// PATIO — Firmen-Branding, EINMAL geladen
// ============================================================
// Firmenname und Logo brauchen inzwischen zwei Bausteine: die
// Navigationsleiste (Wortmarke unten) und die Topbar (erster Teil des
// Brotkrumens). Beide luden es getrennt — also zwei identische Aufrufe von
// `GET /branding` bei jedem Seitenaufbau.
//
// Das ist derselbe Fehler, den PATIO Desktop schon einmal beim Live-Kanal
// gemacht hat: jede Ansicht öffnete ihre eigene Verbindung für dieselben
// Daten. Deshalb hier von vornherein eine geteilte Quelle.
//
// Der Zustand liegt auf Modulebene, nicht in der Funktion — sonst bekäme
// jeder Aufrufer seine eigene Kopie und der Sinn wäre dahin. Der laufende
// Aufruf wird ebenfalls gemerkt, damit zwei Bausteine, die im selben Tick
// mounten, sich nicht doch überholen.
// ============================================================

import { ref } from "vue";
import { api } from "../api";

export interface Branding {
  companyName: string | null;
  logoUrl: string | null;
}

const branding = ref<Branding>({ companyName: null, logoUrl: null });
let laufenderAufruf: Promise<void> | null = null;
let geladen = false;

async function laden(): Promise<void> {
  try {
    branding.value = await api.get<Branding>("/branding");
    geladen = true;
  } catch {
    /* Nicht angemeldet oder Dienst unten — die Aufrufer haben einen
       Rückfall (PATIO-Wortmarke). Kein `geladen = true`, damit ein
       späterer Versuch es noch einmal probiert. */
  } finally {
    laufenderAufruf = null;
  }
}

export function useBranding() {
  return {
    branding,
    /** Lädt beim ersten Aufruf; jeder weitere hängt sich an oder bekommt
     *  sofort den vorhandenen Stand. */
    async ensureBranding(): Promise<void> {
      if (geladen) return;
      if (!laufenderAufruf) laufenderAufruf = laden();
      return laufenderAufruf;
    },
    /** Nach dem Speichern in den Einstellungen: Stand neu holen, damit
     *  Leiste und Brotkrumen den neuen Namen sofort zeigen. */
    async reloadBranding(): Promise<void> {
      geladen = false;
      laufenderAufruf = laden();
      return laufenderAufruf;
    },
  };
}
