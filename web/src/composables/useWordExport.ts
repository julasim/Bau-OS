// ============================================================
// PATIO — Word-/PDF-Export, geteilt über alle Reiter
// ============================================================
// Die Vorlagen-Auswahl und der Download stehen in fünf Reitern der
// Projektakte (Übersicht, Bautagebuch, Meetings, Stunden, Rechnungen). Solange
// alles in einer Datei lag, war das eine Kopie; beim Aufteilen der Akte in
// eigene Reiter-Komponenten wäre es fünf geworden.
//
// ── Warum die Vorlagen nur EINMAL geladen werden ───────────────────────────
//
// Die Liste (`/export-templates`) und die Frage, ob der Server PDF kann
// (`/exports/faehigkeiten`), sind bürointern und ändern sich im Betrieb nicht.
// Fünf Reiter, die sie beim Öffnen je selbst holen, ergäben fünf identische
// Abfragen pro Projektaufruf. Deshalb Modul-Zustand mit gemerktem Ladelauf —
// dasselbe Muster wie `useBranding`.
//
// Die getroffene Auswahl (`gewaehlteVorlage`) wird bewusst mitgeteilt: wer in
// der Übersicht „Protokoll kurz" wählt, meint dieselbe Wahl auch im
// Meetings-Reiter.
// ============================================================

import { ref } from "vue";
import { api } from "../api";
import { dateiHolen } from "../utils/download";

export interface ExportVorlage {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
}

const exportVorlagen = ref<ExportVorlage[]>([]);
// Kann dieser Server PDF? LibreOffice ist optional (rund 350 MB, und jedes
// Offline-Update trägt sie mit). Ein PDF-Knopf, der auf jedem zweiten Server
// einen Fehler liefert, ist schlechter als keiner.
const pdfMoeglich = ref(false);
/** Je Vorlagen-Art (`kind`) die vom Nutzer gewählte Vorlagen-ID. */
const gewaehlteVorlage = ref<Record<string, string>>({});

let geladen = false;
let laeuft: Promise<void> | null = null;

async function ladeExportVorlagen(): Promise<void> {
  if (geladen) return;
  if (laeuft) return laeuft;
  laeuft = (async () => {
    try {
      exportVorlagen.value = await api.get<ExportVorlage[]>("/export-templates");
    } catch {
      exportVorlagen.value = [];
    }
    try {
      pdfMoeglich.value = (await api.get<{ pdf: boolean }>("/exports/faehigkeiten")).pdf;
    } catch {
      pdfMoeglich.value = false;
    }
    geladen = true;
    laeuft = null;
  })();
  return laeuft;
}

/**
 * Die Vorlagen einer Art.
 *
 * Die Auswahl gehört nur dann in die Oberfläche, wenn es mehr als eine gibt —
 * ein Auswahlfeld mit einem Eintrag ist reine Bedienlast.
 *
 * ── Wozu das überhaupt da ist ─────────────────────────────────────────────
 *
 * Alle Export-Endpunkte lesen `?templateId=`, die Oberfläche hat es **nie
 * gesendet**. Damit war jede Vorlage ausser der als Standard markierten im
 * Betrieb unerreichbar — obwohl Hochladen, Testdruck, Herunterladen und die
 * Variablen-Dokumentation vollständig gebaut sind.
 */
function vorlagenFuer(kind: string): ExportVorlage[] {
  return exportVorlagen.value.filter((v) => v.kind === kind);
}

/** Hängt `?templateId=` und bei Bedarf `?format=pdf` an. */
function mitVorlage(pfad: string, kind: string, alsPdf = false): string {
  const teile: string[] = [];
  const id = gewaehlteVorlage.value[kind];
  if (id) teile.push("templateId=" + encodeURIComponent(id));
  if (alsPdf) teile.push("format=pdf");
  if (teile.length === 0) return pfad;
  return pfad + (pfad.includes("?") ? "&" : "?") + teile.join("&");
}

/** Endung passend zum Format — sonst liegt eine PDF als `.docx` auf der Platte. */
function endung(alsPdf: boolean): string {
  return alsPdf ? "pdf" : "docx";
}

export function useWordExport(melde?: (fehler: string) => void | Promise<void>) {
  /** Holt die Datei und meldet einen Fehler über den übergebenen Weg.
   *  Ohne `melde` scheitert der Download still — deshalb übergibt jede
   *  Ansicht ihren Bestätigungsdialog. */
  async function download(url: string, dateiname: string): Promise<void> {
    const fehler = await dateiHolen(url, dateiname || "export");
    if (fehler && melde) await melde(fehler);
  }

  return {
    exportVorlagen,
    pdfMoeglich,
    gewaehlteVorlage,
    ladeExportVorlagen,
    vorlagenFuer,
    mitVorlage,
    endung,
    download,
  };
}
