<script setup lang="ts">
import { formatTimestamp } from "../utils/format";
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { useCurrentUser } from "../composables/useCurrentUser";

const router = useRouter();
const { user: currentUser, isAdmin } = useCurrentUser();

// Client-seitiger Admin-Guard, gleicher Pattern wie AdminUsersView. Backend
// liefert sowieso 403 — das hier verhindert nur das kurze Aufblitzen der UI.
function ensureAdmin() {
  if (currentUser.value && !isAdmin.value) router.replace("/");
}
watch(currentUser, ensureAdmin, { immediate: true });

interface AuditEntry {
  id: string;
  ts: string;
  actorUserId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  event: string;
  targetUserId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  ok: boolean;
}

const entries = ref<AuditEntry[]>([]);
const loading = ref(false);
const errorBanner = ref<string | null>(null);

// ── Filter ──────────────────────────────────────────────
const filterEvent = ref("");
const filterActor = ref("");
const filterIp = ref("");
const limit = ref(100);

const eventOptions = [
  { value: "", label: "Alle Events" },
  { value: "login.", label: "Login (Erfolg + Fehler)", isPrefix: true },
  { value: "login.success", label: "Login erfolgreich" },
  { value: "login.fail", label: "Login fehlgeschlagen" },
  { value: "login.2fa.", label: "2FA-Login (Erfolg + Fehler)", isPrefix: true },
  { value: "2fa.", label: "2FA-Setup (alle)", isPrefix: true },
  { value: "2fa.enable", label: "2FA aktiviert" },
  { value: "2fa.disable", label: "2FA deaktiviert" },
  { value: "password.", label: "Passwort-Aenderungen", isPrefix: true },
  { value: "user.", label: "User-CRUD", isPrefix: true },
  { value: "user.create", label: "User angelegt" },
  { value: "user.delete", label: "User geloescht" },
  { value: "user.role", label: "Rolle geaendert" },
  { value: "bot.", label: "Bot-Token", isPrefix: true },
  { value: "pair.", label: "Telegram-Pairing", isPrefix: true },
];

async function load() {
  loading.value = true;
  errorBanner.value = null;
  try {
    const params = new URLSearchParams();
    params.set("limit", String(limit.value));

    const ev = filterEvent.value.trim();
    if (ev) {
      // Endet auf "." → Prefix-Match. Sonst exakt.
      if (ev.endsWith(".")) params.set("eventPrefix", ev);
      else params.set("event", ev);
    }
    if (filterActor.value.trim()) params.set("actor", filterActor.value.trim());
    if (filterIp.value.trim()) params.set("ip", filterIp.value.trim());

    entries.value = await api.get<AuditEntry[]>(`/admin/audit?${params.toString()}`);
  } catch (e) {
    errorBanner.value = e instanceof Error ? e.message : "Laden fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ── Anzeige-Helpers ─────────────────────────────────────

function formatTs(iso: string): string {
  try {
    return formatTimestamp(iso);
  } catch {
    return iso;
  }
}

function formatDetails(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}: ${formatVal(details[k])}`).join(", ");
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function eventClass(event: string, ok: boolean): string {
  if (!ok || event.endsWith(".fail")) return "audit-pill audit-pill-err";
  if (event === "user.delete") return "audit-pill audit-pill-warn";
  if (
    event === "2fa.enable" ||
    event === "user.create" ||
    event === "login.success" ||
    event === "login.2fa.success" ||
    event === "pair.success"
  )
    return "audit-pill audit-pill-ok";
  return "audit-pill audit-pill-neutral";
}

function eventLabel(event: string): string {
  const map: Record<string, string> = {
    "login.success": "Login OK",
    "login.fail": "Login fehlgeschlagen",
    "login.2fa.success": "2FA-Login OK",
    "login.2fa.fail": "2FA-Login fehlgeschlagen",
    "2fa.enable": "2FA aktiviert",
    "2fa.disable": "2FA deaktiviert",
    "2fa.setup.start": "2FA-Setup gestartet",
    "password.change": "Passwort geaendert",
    "password.admin_reset": "Passwort vom Admin zurueckgesetzt",
    "user.create": "User angelegt",
    "user.delete": "User geloescht",
    "user.role": "Rolle geaendert",
    "user.update": "User aktualisiert",
    "bot.token.set": "Bot-Token gesetzt",
    "bot.token.clear": "Bot-Token entfernt",
    "pair.create": "Pair-Code erstellt",
    "pair.success": "Pairing erfolgreich",
    "pair.fail": "Pairing fehlgeschlagen",
  };
  return map[event] ?? event;
}

const filteredCount = computed(() => entries.value.length);
</script>

<template>
  <div class="admin-audit-wrap">
    <header class="audit-header">
      <div>
        <div class="eyebrow">System</div>
        <h1>Audit-Log</h1>
        <p class="audit-subtitle">
          Sicherheitsrelevante Events: Logins, 2FA, User-CRUD, Bot-Token, Telegram-Pairing. Append-only — Eintraege
          werden nicht editiert.
        </p>
      </div>
    </header>

    <div v-if="errorBanner" class="audit-error">{{ errorBanner }}</div>

    <!-- Filter-Bar -->
    <div class="audit-filters">
      <select v-model="filterEvent" @change="load" class="audit-select">
        <option v-for="opt in eventOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <input v-model="filterActor" type="text" placeholder="Actor-User-ID" class="audit-input" @keyup.enter="load" />
      <input v-model="filterIp" type="text" placeholder="IP" class="audit-input" @keyup.enter="load" />
      <select v-model.number="limit" @change="load" class="audit-select">
        <option :value="50">50 Eintraege</option>
        <option :value="100">100 Eintraege</option>
        <option :value="250">250 Eintraege</option>
        <option :value="500">500 Eintraege</option>
      </select>
      <button @click="load" :disabled="loading" class="audit-btn">
        {{ loading ? "..." : "Aktualisieren" }}
      </button>
    </div>

    <div class="audit-meta">{{ filteredCount }} Eintraege</div>

    <!-- Tabelle (Desktop) -->
    <div class="audit-table-wrap">
      <table class="audit-table">
        <thead>
          <tr>
            <th class="col-ts">Zeit</th>
            <th class="col-event">Event</th>
            <th class="col-actor">Actor</th>
            <th class="col-target">Ziel</th>
            <th class="col-ip">IP</th>
            <th class="col-details">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && entries.length === 0">
            <td colspan="6" class="audit-empty">Keine Eintraege fuer diese Filter.</td>
          </tr>
          <tr v-for="e in entries" :key="e.id" :class="{ 'audit-row-fail': !e.ok }">
            <td class="col-ts mono">{{ formatTs(e.ts) }}</td>
            <td class="col-event">
              <span :class="eventClass(e.event, e.ok)">{{ eventLabel(e.event) }}</span>
            </td>
            <td class="col-actor">
              <span v-if="e.actorUsername">{{ e.actorUsername }}</span>
              <span v-else class="audit-muted">—</span>
              <span v-if="e.actorRole" class="audit-role">{{ e.actorRole }}</span>
            </td>
            <td class="col-target">
              <span v-if="e.targetLabel">{{ e.targetLabel }}</span>
              <span v-else class="audit-muted">—</span>
            </td>
            <td class="col-ip mono">{{ e.ip ?? "—" }}</td>
            <td class="col-details audit-details-cell">{{ formatDetails(e.details) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile-Karten (<768px) -->
    <div class="audit-cards">
      <div v-if="!loading && entries.length === 0" class="audit-empty-card">Keine Eintraege fuer diese Filter.</div>
      <div v-for="e in entries" :key="'card-' + e.id" class="audit-card">
        <div class="audit-card-head">
          <span :class="eventClass(e.event, e.ok)">{{ eventLabel(e.event) }}</span>
          <span class="audit-card-ts">{{ formatTs(e.ts) }}</span>
        </div>
        <div class="audit-card-row">
          <span class="audit-card-key">Actor</span>
          <span
            >{{ e.actorUsername ?? "—" }}<span v-if="e.actorRole" class="audit-role">{{ e.actorRole }}</span></span
          >
        </div>
        <div v-if="e.targetLabel" class="audit-card-row">
          <span class="audit-card-key">Ziel</span>
          <span>{{ e.targetLabel }}</span>
        </div>
        <div class="audit-card-row">
          <span class="audit-card-key">IP</span>
          <span class="mono">{{ e.ip ?? "—" }}</span>
        </div>
        <div v-if="formatDetails(e.details)" class="audit-card-details">
          {{ formatDetails(e.details) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-audit-wrap {
  padding: 24px 32px 32px;
  color: var(--color-text);
}

.audit-header {
  margin-bottom: 20px;
}
.audit-header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}
.audit-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-top: 4px;
  max-width: 560px;
}

.audit-error {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger-text);
  padding: 10px 14px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}

.audit-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.audit-select,
.audit-input {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  outline: none;
}
.audit-input {
  font-family: "JetBrains Mono", monospace;
  min-width: 160px;
}
.audit-select {
  min-width: 160px;
}
.audit-btn {
  padding: 6px 14px;
  background: var(--color-primary);
  color: var(--color-bg);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.audit-btn:disabled {
  opacity: 0.5;
}

.audit-meta {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.audit-table-wrap {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}
.audit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.audit-table th {
  text-align: left;
  padding: 10px 12px;
  background: var(--color-bg-subtle);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}
.audit-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  vertical-align: top;
}
.audit-table tbody tr:last-child td {
  border-bottom: none;
}
.audit-row-fail {
  background: rgba(220, 38, 38, 0.04);
}

.col-ts {
  width: 160px;
  white-space: nowrap;
}
.col-event {
  width: 180px;
}
.col-actor {
  width: 160px;
}
.col-target {
  width: 160px;
}
.col-ip {
  width: 130px;
  white-space: nowrap;
}
.col-details {
  font-size: 12px;
  color: var(--color-text-muted);
}
.audit-details-cell {
  word-break: break-word;
  max-width: 380px;
}

.mono {
  font-family: "JetBrains Mono", monospace;
}

.audit-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.audit-pill-ok {
  background: #dcfce7;
  color: #166534;
}
.audit-pill-err {
  background: #fee2e2;
  color: #991b1b;
}
.audit-pill-warn {
  background: #fef3c7;
  color: #92400e;
}
.audit-pill-neutral {
  background: #f4f4f5;
  color: #52525b;
}

.audit-role {
  margin-left: 4px;
  font-size: 10px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.audit-muted {
  color: var(--color-text-muted);
}

.audit-empty {
  text-align: center;
  padding: 32px 0;
  color: var(--color-text-muted);
}

/* Mobile-Karten */
.audit-cards {
  display: none;
}
.audit-empty-card {
  text-align: center;
  padding: 32px 0;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
}
.audit-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--color-bg);
}
.audit-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.audit-card-ts {
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: "JetBrains Mono", monospace;
}
.audit-card-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 4px;
}
.audit-card-key {
  width: 64px;
  flex-shrink: 0;
  color: var(--color-text-muted);
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.05em;
  padding-top: 2px;
}
.audit-card-details {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-subtle);
  word-break: break-word;
}

@media (max-width: 767.98px) {
  .admin-audit-wrap {
    padding: 16px;
  }
  .audit-table-wrap {
    display: none;
  }
  .audit-cards {
    display: block;
  }
}
</style>
