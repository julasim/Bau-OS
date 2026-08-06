<script setup lang="ts">
// ============================================================
// PATIO — Firmen (Bauherren, Fachplaner, ausführende Firmen)
// ============================================================
// Die API dafür gab es seit Migration 006 vollständig — nur rief sie niemand
// auf: die Oberfläche kannte keinen einzigen `/companies`-Pfad. Firmen
// entstanden deshalb ausschließlich als Nebenwirkung, wenn jemand bei einem
// Teammitglied einen Firmennamen eintippt.
//
// Die Folge im Büro ist absehbar: „Müller GmbH", „Mueller GmbH" und
// „Müller Gmbh" sind drei Firmen, Adresse und Website lassen sich nirgends
// eintragen, und niemand kann das je wieder geradeziehen. Deshalb hat diese
// Ansicht neben dem üblichen Anlegen und Ändern eine Funktion, die sonst
// selten nötig ist: **Zusammenführen**.
// ============================================================
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useConfirm } from "../composables/useConfirm";
import { useCurrentUser } from "../composables/useCurrentUser";
import { useEvents } from "../composables/useEvents";

interface Firma {
  id: string;
  name: string;
  address: string | null;
  website: string | null;
  notes: string | null;
  memberCount?: number;
}

const { confirm } = useConfirm();
const { isAdmin } = useCurrentUser();

const firmen = ref<Firma[]>([]);
const geladen = ref(false);
const fehler = ref<string | null>(null);
const suche = ref("");

const gefiltert = computed(() => {
  const q = suche.value.trim().toLowerCase();
  if (!q) return firmen.value;
  return firmen.value.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      (f.address ?? "").toLowerCase().includes(q) ||
      (f.notes ?? "").toLowerCase().includes(q),
  );
});

/** Namen, die sich nur in Schreibweise unterscheiden, stehen im Verdacht,
 *  Dubletten zu sein. Bewusst eine grobe Heuristik: Umlaute aufgelöst,
 *  Rechtsform und Satzzeichen weg. Sie schlägt nur einen Hinweis vor —
 *  entschieden wird von Hand. */
function kennung(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\b(gmbh|ag|kg|og|ohg|e\.?u\.?|ges\.?m\.?b\.?h\.?|zt)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const verdaechtig = computed(() => {
  const nach = new Map<string, Firma[]>();
  for (const f of firmen.value) {
    const k = kennung(f.name);
    if (!k) continue;
    if (!nach.has(k)) nach.set(k, []);
    nach.get(k)!.push(f);
  }
  return Array.from(nach.values()).filter((g) => g.length > 1);
});

// ── Editor ──────────────────────────────────────────────────────────────────
const editorOffen = ref(false);
const bearbeiteteId = ref<string | null>(null);
const entwurf = ref({ name: "", address: "", website: "", notes: "" });

function neu() {
  bearbeiteteId.value = null;
  entwurf.value = { name: "", address: "", website: "", notes: "" };
  editorOffen.value = true;
}

function bearbeiten(f: Firma) {
  bearbeiteteId.value = f.id;
  entwurf.value = {
    name: f.name,
    address: f.address ?? "",
    website: f.website ?? "",
    notes: f.notes ?? "",
  };
  editorOffen.value = true;
}

async function speichern() {
  if (!entwurf.value.name.trim()) return;
  fehler.value = null;
  const koerper = {
    name: entwurf.value.name.trim(),
    address: entwurf.value.address.trim() || null,
    website: entwurf.value.website.trim() || null,
    notes: entwurf.value.notes.trim() || null,
  };
  try {
    if (bearbeiteteId.value) await api.patch(`/companies/${bearbeiteteId.value}`, koerper);
    else await api.post("/companies", koerper);
    editorOffen.value = false;
    await laden();
  } catch (e) {
    // Der Server antwortet bei einem doppelten Namen mit 409 und sagt das
    // auch. Der Editor bleibt offen, damit die Eingabe nicht verloren geht.
    fehler.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  }
}

async function loeschen(f: Firma) {
  const anzahl = f.memberCount ?? 0;
  const zusatz =
    anzahl > 0
      ? ` ${anzahl} ${anzahl === 1 ? "Person bleibt" : "Personen bleiben"} erhalten, verliert dabei aber die Firmenzuordnung.`
      : "";
  if (!(await confirm({ message: `Firma „${f.name}" löschen?${zusatz}`, confirmDanger: true }))) return;
  try {
    await api.delete(`/companies/${f.id}`);
    await laden();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

// ── Zusammenführen ──────────────────────────────────────────────────────────
const mergeQuelle = ref<Firma | null>(null);
const mergeZielId = ref<string | null>(null);

const mergeZiele = computed(() => firmen.value.filter((f) => f.id !== mergeQuelle.value?.id));

function zusammenfuehrenOeffnen(f: Firma) {
  mergeQuelle.value = f;
  // Vorschlag: die verdächtige Dublette mit den meisten Mitgliedern — die ist
  // in aller Regel die „richtige", auf die zusammengeführt werden soll.
  const gruppe = verdaechtig.value.find((g) => g.some((x) => x.id === f.id));
  const vorschlag = gruppe?.filter((x) => x.id !== f.id).sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))[0];
  mergeZielId.value = vorschlag?.id ?? null;
}

async function zusammenfuehren() {
  const quelle = mergeQuelle.value;
  const ziel = firmen.value.find((f) => f.id === mergeZielId.value);
  if (!quelle || !ziel) return;
  const bestaetigt = await confirm({
    message:
      `„${quelle.name}" in „${ziel.name}" zusammenführen? ` +
      `Alle zugeordneten Personen wechseln zu „${ziel.name}", danach fällt „${quelle.name}" weg. ` +
      `Das lässt sich nicht rückgängig machen.`,
    confirmDanger: true,
  });
  if (!bestaetigt) return;
  fehler.value = null;
  try {
    await api.post(`/companies/${quelle.id}/zusammenfuehren`, { zielId: ziel.id });
    mergeQuelle.value = null;
    await laden();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Zusammenführen fehlgeschlagen";
  }
}

async function laden() {
  fehler.value = null;
  try {
    firmen.value = await api.get<Firma[]>("/companies");
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Firmen konnten nicht geladen werden";
  } finally {
    geladen.value = true;
  }
}

useEvents(["team"], () => {
  void laden();
});

onMounted(laden);
</script>

<template>
  <div class="fi-wrap">
    <header class="fi-head">
      <div>
        <div class="eyebrow">Stammdaten</div>
        <h1 class="fi-title">Firmen</h1>
        <p class="fi-lead">
          Bauherren, Fachplaner und ausführende Firmen. Einträge entstehen auch von selbst, wenn bei einer Person ein
          Firmenname eingetragen wird — hier lassen sie sich ergänzen, korrigieren und zusammenführen.
        </p>
      </div>
      <button class="row-action" @click="neu"><BIcon name="plus" :size="12" /> Neue Firma</button>
    </header>

    <div v-if="fehler" class="fi-error">{{ fehler }}</div>

    <!-- Dubletten-Hinweis: der eigentliche Grund für diese Ansicht -->
    <div v-if="verdaechtig.length > 0 && isAdmin" class="fi-hinweis">
      <BIcon name="info" :size="13" />
      <div>
        <strong>{{ verdaechtig.length }}</strong>
        {{ verdaechtig.length === 1 ? "Gruppe sieht" : "Gruppen sehen" }} nach einer doppelten Erfassung aus:
        <span v-for="(g, i) in verdaechtig" :key="i" class="fi-dublette">
          {{ g.map((f) => f.name).join(" · ") }}
        </span>
        <div class="fi-hinweis-sub">
          Verglichen wird ohne Umlaute, Rechtsform und Satzzeichen — das ist ein Hinweis, keine Feststellung.
        </div>
      </div>
    </div>

    <!-- Editor -->
    <div v-if="editorOffen" class="fi-editor">
      <div class="fi-row">
        <label class="fi-field fi-field-wide">
          <span class="eyebrow">Name</span>
          <input v-model="entwurf.name" type="text" class="stamm-input" placeholder="z. B. Zimmerei Huber GmbH" />
        </label>
        <label class="fi-field fi-field-wide">
          <span class="eyebrow">Website</span>
          <input v-model="entwurf.website" type="text" class="stamm-input" placeholder="https://…" />
        </label>
      </div>
      <label class="fi-field">
        <span class="eyebrow">Adresse</span>
        <input v-model="entwurf.address" type="text" class="stamm-input" placeholder="Straße, PLZ Ort" />
      </label>
      <label class="fi-field">
        <span class="eyebrow">Notizen</span>
        <textarea
          v-model="entwurf.notes"
          class="stamm-input"
          rows="2"
          placeholder="Gewerk, Ansprechpartner…"
        ></textarea>
      </label>
      <div class="fi-actions">
        <button class="row-action" :disabled="!entwurf.name.trim()" @click="speichern">Speichern</button>
        <button class="row-action" @click="editorOffen = false">Abbrechen</button>
      </div>
    </div>

    <!-- Zusammenführen -->
    <div v-if="mergeQuelle" class="fi-editor">
      <div class="eyebrow" style="margin-bottom: 6px">Zusammenführen</div>
      <p class="fi-merge-text">
        Alle Personen von <strong>{{ mergeQuelle.name }}</strong> wechseln zur ausgewählten Firma, danach fällt
        <strong>{{ mergeQuelle.name }}</strong> weg.
      </p>
      <div class="fi-row">
        <label class="fi-field fi-field-wide">
          <span class="eyebrow">Ziel</span>
          <select v-model="mergeZielId" class="stamm-input">
            <option :value="null">— bitte wählen —</option>
            <option v-for="f in mergeZiele" :key="f.id" :value="f.id">
              {{ f.name }}{{ f.memberCount ? ` (${f.memberCount})` : "" }}
            </option>
          </select>
        </label>
      </div>
      <div class="fi-actions">
        <button class="row-action row-action-danger" :disabled="!mergeZielId" @click="zusammenfuehren">
          Zusammenführen
        </button>
        <button class="row-action" @click="mergeQuelle = null">Abbrechen</button>
      </div>
    </div>

    <input v-model="suche" type="search" class="stamm-input fi-suche" placeholder="Firma suchen…" />

    <div v-if="!geladen" class="empty-hint">Lade…</div>
    <div v-else-if="firmen.length === 0" class="empty-hint">
      Noch keine Firma erfasst. Einträge entstehen auch von selbst, sobald bei einer Person ein Firmenname hinterlegt
      wird.
    </div>
    <div v-else-if="gefiltert.length === 0" class="empty-hint">Keine Firma passt zu „{{ suche }}".</div>

    <ul v-else class="fi-list">
      <li v-for="f in gefiltert" :key="f.id" class="fi-item">
        <div class="fi-item-main">
          <span class="fi-name">{{ f.name }}</span>
          <span v-if="f.address" class="fi-meta">{{ f.address }}</span>
          <span v-if="f.notes" class="fi-meta">{{ f.notes }}</span>
        </div>
        <span class="fi-anzahl font-mono" :title="(f.memberCount ?? 0) + ' zugeordnete Personen'">
          {{ f.memberCount ?? 0 }}
        </span>
        <div class="fi-item-actions">
          <a v-if="f.website" :href="f.website" target="_blank" rel="noopener" class="row-action" title="Website">
            <BIcon name="link" :size="11" />
          </a>
          <button class="row-action" title="Bearbeiten" @click="bearbeiten(f)">
            <BIcon name="pencil" :size="11" />
          </button>
          <button
            v-if="isAdmin"
            class="row-action"
            title="Mit einer anderen Firma zusammenführen"
            @click="zusammenfuehrenOeffnen(f)"
          >
            <BIcon name="layers" :size="11" />
          </button>
          <button v-if="isAdmin" class="row-action row-action-danger" title="Löschen" @click="loeschen(f)">
            <BIcon name="x" :size="11" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fi-wrap {
  padding: 24px;
  max-width: 900px;
}
.fi-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.fi-title {
  font-size: 18px;
  font-weight: 600;
  margin: 6px 0 8px;
  letter-spacing: -0.01em;
}
.fi-lead {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
  max-width: 66ch;
}
.fi-error {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}
.fi-hinweis {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--color-border);
  border-left-width: 3px;
  padding: 10px 12px;
  margin-bottom: 16px;
  font-size: 12px;
  line-height: 1.6;
}
.fi-dublette {
  display: block;
  color: var(--color-text-muted);
}
.fi-hinweis-sub {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 4px;
}
.fi-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--color-border);
  padding: 14px;
  margin-bottom: 16px;
}
.fi-merge-text {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
}
.fi-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.fi-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 180px;
}
.fi-field-wide {
  min-width: 220px;
}
.fi-actions {
  display: flex;
  gap: 8px;
}
.fi-suche {
  margin-bottom: 12px;
  max-width: 320px;
}
.fi-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--color-border);
}
.fi-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 4px;
  border-bottom: 1px solid var(--color-border);
}
.fi-item-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.fi-name {
  font-size: 13px;
  font-weight: 500;
}
.fi-meta {
  font-size: 11px;
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fi-anzahl {
  width: 32px;
  text-align: right;
  font-size: 12px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.fi-item-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
</style>
