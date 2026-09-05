<script setup lang="ts">
// ============================================================
// PATIO — Sicherungs-Status (Verwaltung)
// ============================================================
// Die Sicherung läuft als systemd-Timer auf dem Server. `OnFailure=` meldet
// einen Fehlschlag ins Journal — nur schaut dort niemand hinein. Diese Seite
// beantwortet die eine Frage, die zählt: **hat die Sicherung heute Nacht
// geklappt?**
//
// Sie zeigt nur an; ausgelöst wird die Sicherung hier nicht. Der Container
// hat weder Docker noch systemd noch Schreibzugriff auf die Platte — und das
// soll so bleiben.
// ============================================================
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { dateiHolen } from "../utils/download";
import { formatDate, heuteIso } from "../utils/format";

interface Stand {
  stufe: "taeglich" | "woechentlich" | "monatlich";
  name: string;
  zeitpunkt: string;
  groesse: number;
  vollstaendig: boolean;
}

interface Status {
  eingerichtet: boolean;
  hinweis?: string;
  inOrdnung?: boolean;
  stundenHer?: number | null;
  juengste?: Stand | null;
  anzahl?: { taeglich: number; woechentlich: number; monatlich: number; abgebrochen: number };
  staende: Stand[];
}

const router = useRouter();
const { user: currentUser, isAdmin } = useCurrentUser();

const status = ref<Status | null>(null);
const geladen = ref(false);
const fehler = ref<string | null>(null);

function ensureAdmin() {
  if (currentUser.value && !isAdmin.value) router.replace("/");
}
onMounted(ensureAdmin);

const STUFE_LABEL: Record<Stand["stufe"], string> = {
  taeglich: "Täglich",
  woechentlich: "Wöchentlich",
  monatlich: "Monatlich",
};

function groesse(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${bytes} B`;
}

function alter(stunden: number | null | undefined): string {
  if (stunden === null || stunden === undefined) return "—";
  if (stunden < 1) return "vor weniger als einer Stunde";
  if (stunden < 24) return `vor ${stunden} Stunden`;
  const tage = Math.floor(stunden / 24);
  return tage === 1 ? "vor einem Tag" : `vor ${tage} Tagen`;
}

async function laden() {
  fehler.value = null;
  try {
    status.value = await api.get<Status>("/sicherung");
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Status konnte nicht geladen werden";
  } finally {
    geladen.value = true;
  }
}

// ── Volldump ──────────────────────────────────────────────────────────────
//
// Er steht bewusst HIER und nicht unter „Export": eine Sicherung hilft, wenn
// PATIO wieder aufgesetzt wird — der Volldump hilft, wenn es NICHT mehr
// aufgesetzt wird. Beides gehört auf dieselbe Seite, weil es dieselbe Frage
// beantwortet: was bleibt, wenn etwas schiefgeht.
const dumpLaeuft = ref(false);

async function volldumpHolen() {
  dumpLaeuft.value = true;
  fehler.value = null;
  try {
    const f = await dateiHolen("/api/exports/volldump", `PATIO Volldump ${heuteIso()}.zip`);
    if (f) fehler.value = f;
  } finally {
    dumpLaeuft.value = false;
  }
}

onMounted(laden);
</script>

<template>
  <div class="sic-wrap">
    <header class="sic-head">
      <div class="eyebrow">Verwaltung</div>
      <h1 class="sic-title">Sicherung</h1>
      <p class="sic-lead">
        Die nächtliche Sicherung läuft auf dem Server und schreibt auf die externe Platte. Diese Seite zeigt, ob sie
        durchgelaufen ist — sie löst keine Sicherung aus.
      </p>
    </header>

    <section class="sic-dump">
      <div>
        <div class="sic-karte-titel">Alles als Textdateien mitnehmen</div>
        <p class="sic-karte-text">
          Ein ZIP mit dem gesamten Bestand als Markdown-Ordnerbaum: ein Ordner je Projekt, darin Stammdaten, Notizen,
          Aufgaben, Termine, Protokolle, Entscheidungen, Bautagebuch, Phasen, Rechnungen — und die abgelegten Dateien.
          Lesbar mit jedem Texteditor, ohne PATIO.
        </p>
        <p class="sic-karte-text">
          Das ersetzt <strong>keine</strong> Sicherung. Eine Sicherung hilft, wenn PATIO wieder aufgesetzt wird; dieser
          Ordnerbaum hilft, wenn es nicht mehr aufgesetzt wird.
        </p>
      </div>
      <button class="patio-btn solid sm" :disabled="dumpLaeuft" @click="volldumpHolen">
        {{ dumpLaeuft ? "wird erzeugt …" : "Volldump herunterladen" }}
      </button>
    </section>

    <div v-if="fehler" class="sic-error">{{ fehler }}</div>
    <div v-if="!geladen" class="empty-hint">Lade…</div>

    <template v-else-if="status">
      <div v-if="!status.eingerichtet" class="sic-karte sic-neutral">
        <BIcon name="info" :size="14" />
        <div>
          <div class="sic-karte-titel">Kein Sicherungsverzeichnis gefunden</div>
          <p class="sic-karte-text">{{ status.hinweis }}</p>
        </div>
      </div>

      <template v-else>
        <!-- Die eine Frage, die zählt. Deshalb steht sie oben und groß. -->
        <div class="sic-karte" :class="status.inOrdnung ? 'sic-ok' : 'sic-alarm'">
          <BIcon :name="status.inOrdnung ? 'check' : 'x'" :size="14" />
          <div>
            <div class="sic-karte-titel">
              {{ status.inOrdnung ? "Die Sicherung ist aktuell" : "Die Sicherung ist überfällig" }}
            </div>
            <p class="sic-karte-text">
              <template v-if="status.juengste">
                Letzter vollständiger Stand: <strong>{{ status.juengste.name }}</strong> ({{
                  alter(status.stundenHer)
                }}, {{ groesse(status.juengste.groesse) }}).
                <template v-if="!status.inOrdnung">
                  Der Zeitplan sieht einen Lauf pro Nacht vor — mindestens einer ist ausgefallen. Prüfen mit
                  <code>journalctl -u patio-backup.service --since '-3 days'</code>.
                </template>
              </template>
              <template v-else>
                Es gibt keinen einzigen vollständigen Stand. Solange das so ist, gibt es keinen Rückweg.
              </template>
            </p>
          </div>
        </div>

        <div v-if="status.anzahl" class="sic-zahlen">
          <div class="sic-zahl">
            <span class="sic-zahl-wert">{{ status.anzahl.taeglich }}</span>
            <span class="sic-zahl-label">täglich</span>
          </div>
          <div class="sic-zahl">
            <span class="sic-zahl-wert">{{ status.anzahl.woechentlich }}</span>
            <span class="sic-zahl-label">wöchentlich</span>
          </div>
          <div class="sic-zahl">
            <span class="sic-zahl-wert">{{ status.anzahl.monatlich }}</span>
            <span class="sic-zahl-label">monatlich</span>
          </div>
          <div class="sic-zahl" :class="{ 'sic-zahl-warn': status.anzahl.abgebrochen > 0 }">
            <span class="sic-zahl-wert">{{ status.anzahl.abgebrochen }}</span>
            <span class="sic-zahl-label">abgebrochen</span>
          </div>
        </div>

        <h2 class="sic-h2">Vorhandene Stände</h2>
        <ul class="sic-list">
          <li v-for="s in status.staende" :key="s.stufe + s.name" class="sic-item">
            <span class="sic-stufe">{{ STUFE_LABEL[s.stufe] }}</span>
            <span class="sic-name font-mono">{{ s.name }}</span>
            <span class="sic-datum">{{ formatDate(s.zeitpunkt) }}</span>
            <span class="sic-groesse font-mono">{{ groesse(s.groesse) }}</span>
            <span class="sic-marker" :class="s.vollstaendig ? 'sic-marker-ok' : 'sic-marker-warn'">
              {{ s.vollstaendig ? "vollständig" : "abgebrochen" }}
            </span>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Die neutrale Variante der Sicherungs-Karte (noch nicht eingerichtet).
 * War nirgends definiert; die Karte sah aus wie eine gemeldete Stoerung. */
.sic-neutral {
  border-color: var(--border);
  background: var(--surface-2);
}

.sic-dump {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 16px;
  margin-bottom: 16px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
}
.sic-dump button {
  flex-shrink: 0;
  margin-top: 2px;
}
@media (max-width: 700px) {
  .sic-dump {
    flex-direction: column;
  }
}

.sic-wrap {
  padding: 24px;
  max-width: 900px;
}
.sic-head {
  margin-bottom: 20px;
}
.sic-title {
  font-size: 18px;
  font-weight: 600;
  margin: 6px 0 8px;
  letter-spacing: -0.01em;
}
.sic-lead {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
  max-width: 66ch;
}
.sic-error {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
  font-size: 12px;
  margin-bottom: 16px;
}
.sic-karte {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--color-border);
  padding: 12px 14px;
  margin-bottom: 16px;
}
.sic-ok {
  border-left-width: 3px;
}
.sic-alarm {
  border-left-width: 3px;
  border-left-color: var(--color-text);
  background: var(--color-bg-subtle);
}
.sic-karte-titel {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 3px;
}
.sic-karte-text {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
}
.sic-karte-text code {
  font-size: 11px;
}
.sic-zahlen {
  display: flex;
  gap: 28px;
  padding: 12px 2px 16px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 16px;
}
.sic-zahl {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sic-zahl-wert {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.sic-zahl-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
}
.sic-zahl-warn .sic-zahl-wert {
  font-weight: 600;
}
.sic-h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin: 0 0 6px;
  font-weight: 500;
}
.sic-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--color-border);
}
.sic-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 4px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
}
.sic-stufe {
  width: 96px;
  color: var(--color-text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.sic-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sic-datum {
  width: 100px;
  color: var(--color-text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.sic-groesse {
  width: 72px;
  text-align: right;
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.sic-marker {
  width: 96px;
  text-align: right;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.sic-marker-ok {
  color: var(--color-text-tertiary);
}
.sic-marker-warn {
  color: var(--color-text);
  font-weight: 600;
}
</style>
