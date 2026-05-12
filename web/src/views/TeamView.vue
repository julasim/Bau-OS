<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

// ── Typen ────────────────────────────────────────────────
type MemberType = "Intern" | "Planer" | "Ausführende" | "Behörde" | "Lieferant" | "Bauherr";

interface TeamMemberProject {
  id: string;
  name: string;
  projectRole: string | null;
}
interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  companyId: string | null;
  companyName: string | null;
  memberType: MemberType | null;
  projects: TeamMemberProject[];
  createdAt: string;
  updatedAt: string;
}
interface Company {
  id: string;
  name: string;
}

// ── State ────────────────────────────────────────────────
const router = useRouter();
const members = ref<TeamMember[]>([]);
const companies = ref<Company[]>([]);
const loading = ref(false);

const searchQuery = ref("");
const filterType = ref<string>(""); // leer = alle
const filterCompany = ref<string>(""); // leer = alle
type SortKey = "name" | "company" | "type" | "updated";
const sortKey = ref<SortKey>("name");
const viewMode = ref<"grid" | "list">("grid");

const MEMBER_TYPES: MemberType[] = ["Intern", "Planer", "Ausführende", "Behörde", "Lieferant", "Bauherr"];

// ── Filter + Sort ────────────────────────────────────────
const filtered = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  const list = members.value.filter((m) => {
    if (filterType.value && m.memberType !== filterType.value) return false;
    if (filterCompany.value && (m.companyName ?? m.company) !== filterCompany.value) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      (m.role?.toLowerCase().includes(q) ?? false) ||
      (m.email?.toLowerCase().includes(q) ?? false) ||
      (m.phone?.toLowerCase().includes(q) ?? false) ||
      ((m.companyName ?? m.company)?.toLowerCase().includes(q) ?? false)
    );
  });
  const sorted = [...list];
  switch (sortKey.value) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, "de"));
      break;
    case "company":
      sorted.sort((a, b) => {
        const an = (a.companyName ?? a.company ?? "").toLowerCase();
        const bn = (b.companyName ?? b.company ?? "").toLowerCase();
        if (!an && !bn) return a.name.localeCompare(b.name, "de");
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn) || a.name.localeCompare(b.name, "de");
      });
      break;
    case "type":
      sorted.sort((a, b) => {
        const at = a.memberType ?? "zzz";
        const bt = b.memberType ?? "zzz";
        return at.localeCompare(bt) || a.name.localeCompare(b.name, "de");
      });
      break;
    case "updated":
      sorted.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return sorted;
});

const anyFilterActive = computed(() => !!searchQuery.value.trim() || !!filterType.value || !!filterCompany.value);
function resetFilters() {
  searchQuery.value = "";
  filterType.value = "";
  filterCompany.value = "";
}

// Dynamische Firmen-Dropdown-Werte aus vorhandenen Mitgliedern.
const companyOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const m of members.value) {
    const c = m.companyName ?? m.company;
    if (c && c.trim()) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
});

// ── Neu-anlegen-Dialog ──────────────────────────────────
const showCreateDialog = ref(false);
const createSaving = ref(false);
const createError = ref<string | null>(null);
const createForm = ref({
  name: "",
  role: "",
  memberType: "" as string,
  companyName: "",
  email: "",
  phone: "",
});

function openCreateDialog() {
  showCreateDialog.value = true;
  createError.value = null;
  createForm.value = { name: "", role: "", memberType: "", companyName: "", email: "", phone: "" };
}
function closeCreateDialog() {
  if (createSaving.value) return;
  showCreateDialog.value = false;
}
async function submitCreate() {
  const name = createForm.value.name.trim();
  if (!name || createSaving.value) return;
  // Name-Duplikat client-seitig abfangen.
  if (members.value.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    createError.value = "Ein Mitglied mit diesem Namen existiert bereits.";
    return;
  }
  createSaving.value = true;
  createError.value = null;
  try {
    const payload = {
      name,
      role: createForm.value.role.trim() || undefined,
      memberType: createForm.value.memberType || undefined,
      companyName: createForm.value.companyName.trim() || undefined,
      email: createForm.value.email.trim() || undefined,
      phone: createForm.value.phone.trim() || undefined,
    };
    const created = await api.post<TeamMember>("/team", payload);
    showCreateDialog.value = false;
    router.push(`/team/${encodeURIComponent(created.id)}`);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    createSaving.value = false;
  }
}

// ── Helpers ──────────────────────────────────────────────
function initial(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function typeColor(t: MemberType | null): string {
  // Subtile Farbcodierung nach Kategorie — hilft bei Grid-Scan.
  switch (t) {
    case "Intern":
      return "#3b82f6";
    case "Planer":
      return "#a855f7";
    case "Ausführende":
      return "#f59e0b";
    case "Behörde":
      return "#64748b";
    case "Lieferant":
      return "#10b981";
    case "Bauherr":
      return "#ec4899";
    default:
      return "#9ca3af";
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    const [m, c] = await Promise.all([
      api.get<TeamMember[]>("/team"),
      api.get<Company[]>("/companies").catch(() => [] as Company[]),
    ]);
    members.value = m;
    companies.value = c;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Kontakte</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Team</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ members.length }} Mitglieder<span v-if="companies.length > 0"> · {{ companies.length }} Firmen</span>
        </p>
      </div>
      <div class="flex items-center" style="gap: 8px">
        <button @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'" class="bauos-btn ghost">
          <BIcon :name="viewMode === 'grid' ? 'list' : 'grid'" :size="14" />
          {{ viewMode === "grid" ? "Liste" : "Kacheln" }}
        </button>
        <button @click="openCreateDialog" class="bauos-btn solid">
          <BIcon name="plus" :size="14" />
          <span style="margin-left: 4px">Neue Person</span>
        </button>
      </div>
    </div>

    <!-- Filter-Bar -->
    <div v-if="members.length > 3" class="filter-bar">
      <div
        class="flex items-center"
        style="
          gap: 8px;
          padding: 6px 12px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-bg);
        "
      >
        <BIcon name="search" :size="14" style="color: var(--color-text-muted)" />
        <input
          v-model="searchQuery"
          placeholder="Name, Rolle, Firma, E-Mail, Telefon…"
          style="
            flex: 1;
            border: none;
            outline: none;
            background: transparent;
            font-size: 13px;
            color: var(--color-text);
          "
        />
        <span style="font-size: 11px; color: var(--color-text-tertiary)">
          {{ filtered.length }} / {{ members.length }}
        </span>
      </div>

      <select v-model="filterType" class="filter-select">
        <option value="">Alle Kategorien</option>
        <option v-for="t in MEMBER_TYPES" :key="t" :value="t">{{ t }}</option>
      </select>
      <select v-if="companyOptions.length > 0" v-model="filterCompany" class="filter-select">
        <option value="">Alle Firmen</option>
        <option v-for="c in companyOptions" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="sortKey" class="filter-select">
        <option value="name">Name (A–Z)</option>
        <option value="company">Firma</option>
        <option value="type">Kategorie</option>
        <option value="updated">Zuletzt geändert</option>
      </select>
      <button
        v-if="anyFilterActive"
        @click="resetFilters"
        class="bauos-btn ghost"
        style="padding: 4px 10px; font-size: 11px"
      >
        Filter zurücksetzen
      </button>
    </div>

    <!-- Grid -->
    <div
      v-if="viewMode === 'grid'"
      class="grid"
      style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px"
    >
      <div
        v-for="m in filtered"
        :key="m.id"
        class="member-card"
        :style="{ '--accent-color': typeColor(m.memberType) }"
        @click="router.push(`/team/${encodeURIComponent(m.id)}`)"
      >
        <div class="flex items-center" style="gap: 12px; margin-bottom: 10px">
          <div class="member-avatar" :style="{ background: typeColor(m.memberType) }">
            {{ initial(m.name) }}
          </div>
          <div style="min-width: 0; flex: 1">
            <div class="member-name">{{ m.name }}</div>
            <div class="member-sub">
              <span v-if="m.role">{{ m.role }}</span>
              <span v-if="m.role && (m.companyName || m.company)"> · </span>
              <span v-if="m.companyName || m.company">{{ m.companyName ?? m.company }}</span>
            </div>
          </div>
        </div>
        <div
          v-if="m.memberType"
          class="member-pill"
          :style="{ color: typeColor(m.memberType), borderColor: typeColor(m.memberType) }"
        >
          {{ m.memberType }}
        </div>
        <div v-if="m.projects.length > 0" style="margin-top: 10px; font-size: 11px; color: var(--color-text-muted)">
          <BIcon name="folder" :size="10" />
          <span style="margin-left: 4px">
            {{ m.projects.length }} Projekt<span v-if="m.projects.length !== 1">e</span>
          </span>
        </div>
      </div>
      <div v-if="filtered.length === 0 && !loading" class="tv-empty-state" style="grid-column: 1 / -1">
        <template v-if="anyFilterActive">
          <div class="tv-empty-icon">🔍</div>
          <p class="tv-empty-title">Keine Treffer</p>
          <p class="tv-empty-sub">Versuche andere Filtereinstellungen.</p>
          <button class="tv-empty-cta" @click="resetFilters">Filter zurücksetzen</button>
        </template>
        <template v-else>
          <div class="tv-empty-icon">👥</div>
          <p class="tv-empty-title">Noch keine Team-Mitglieder</p>
          <p class="tv-empty-sub">Lege deine erste Person an um loszulegen.</p>
          <button class="tv-empty-cta" @click="openCreateDialog">+ Erste Person</button>
        </template>
      </div>
    </div>

    <!-- List -->
    <div
      v-else
      class="team-list-wrap"
      style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden"
    >
      <div class="team-list-inner">
        <div
          class="flex items-center"
          style="
            gap: 12px;
            padding: 10px 16px;
            background: var(--color-bg-subtle);
            border-bottom: 1px solid var(--color-border);
          "
        >
          <span class="eyebrow flex-1">Name</span>
          <span class="eyebrow" style="width: 140px">Firma</span>
          <span class="eyebrow" style="width: 100px">Kategorie</span>
          <span class="eyebrow" style="width: 60px; text-align: center">Projekte</span>
        </div>
        <div
          v-for="m in filtered"
          :key="m.id"
          class="member-row"
          @click="router.push(`/team/${encodeURIComponent(m.id)}`)"
        >
          <div class="flex-1 min-w-0 flex items-center" style="gap: 10px">
            <div class="member-avatar member-avatar-sm" :style="{ background: typeColor(m.memberType) }">
              {{ initial(m.name) }}
            </div>
            <div style="min-width: 0">
              <div style="font-size: 13px; color: var(--color-text)">{{ m.name }}</div>
              <div v-if="m.role" class="member-row-role">{{ m.role }}</div>
            </div>
          </div>
          <span
            style="
              width: 140px;
              font-size: 12px;
              color: var(--color-text-muted);
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            "
          >
            {{ m.companyName ?? m.company ?? "—" }}
          </span>
          <span v-if="m.memberType" style="width: 100px; font-size: 11px" :style="{ color: typeColor(m.memberType) }">
            {{ m.memberType }}
          </span>
          <span v-else style="width: 100px; font-size: 11px; color: var(--color-text-faint)">—</span>
          <span style="width: 60px; text-align: center; font-size: 11px; color: var(--color-text-muted)">
            {{ m.projects.length }}
          </span>
        </div>
        <div v-if="filtered.length === 0 && !loading" class="tv-empty-state">
          <template v-if="anyFilterActive">
            <div class="tv-empty-icon">🔍</div>
            <p class="tv-empty-title">Keine Treffer</p>
            <p class="tv-empty-sub">Versuche andere Filtereinstellungen.</p>
            <button class="tv-empty-cta" @click="resetFilters">Filter zurücksetzen</button>
          </template>
          <template v-else>
            <div class="tv-empty-icon">👥</div>
            <p class="tv-empty-title">Noch keine Team-Mitglieder</p>
            <p class="tv-empty-sub">Lege deine erste Person an um loszulegen.</p>
            <button class="tv-empty-cta" @click="openCreateDialog">+ Erste Person</button>
          </template>
        </div>
      </div>
    </div>

    <!-- Neu-anlegen-Dialog -->
    <div v-if="showCreateDialog" class="modal-overlay" @click.self="closeCreateDialog">
      <div class="modal-card">
        <div class="flex items-center justify-between" style="margin-bottom: 16px">
          <div>
            <div class="eyebrow" style="margin-bottom: 4px">Neu</div>
            <h2 style="font-size: 18px; font-weight: 600; margin: 0">Person anlegen</h2>
          </div>
          <button class="modal-close" @click="closeCreateDialog" :disabled="createSaving">
            <BIcon name="x" :size="14" />
          </button>
        </div>
        <div class="form-grid">
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Name *</span>
            <input
              v-model="createForm.name"
              type="text"
              placeholder="Vor- und Nachname"
              class="form-input-lg"
              @keyup.enter="submitCreate"
              autofocus
            />
          </label>
          <label class="form-field">
            <span class="eyebrow">Kategorie</span>
            <select v-model="createForm.memberType" class="form-input-lg">
              <option value="">—</option>
              <option v-for="t in MEMBER_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </label>
          <label class="form-field">
            <span class="eyebrow">Rolle / Beruf</span>
            <input v-model="createForm.role" type="text" placeholder="z.B. Statiker" class="form-input-lg" />
          </label>
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Firma</span>
            <input
              v-model="createForm.companyName"
              type="text"
              list="team-company-options"
              placeholder="Firmenname — wird automatisch angelegt wenn neu"
              class="form-input-lg"
            />
            <datalist id="team-company-options">
              <option v-for="c in companyOptions" :key="c" :value="c" />
            </datalist>
          </label>
          <label class="form-field">
            <span class="eyebrow">E-Mail</span>
            <input v-model="createForm.email" type="email" placeholder="max@beispiel.at" class="form-input-lg" />
          </label>
          <label class="form-field">
            <span class="eyebrow">Telefon</span>
            <input v-model="createForm.phone" type="tel" placeholder="+43 …" class="form-input-lg" />
          </label>
        </div>
        <div
          v-if="createError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ createError }}
        </div>
        <div class="flex items-center justify-between" style="margin-top: 20px">
          <span style="font-size: 11px; color: var(--color-text-faint)">
            * Pflichtfeld — Rest im Detail nachtragbar.
          </span>
          <div class="flex items-center" style="gap: 8px">
            <button class="bauos-btn ghost" @click="closeCreateDialog" :disabled="createSaving">Abbrechen</button>
            <button class="bauos-btn solid" @click="submitCreate" :disabled="!createForm.name.trim() || createSaving">
              {{ createSaving ? "…" : "Anlegen" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.filter-bar > div:first-child {
  flex: 1 1 260px;
  min-width: 220px;
}
.filter-select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  transition: border-color 180ms ease;
}
.filter-select:hover {
  border-color: var(--color-text-faint);
}

.member-card {
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--accent-color, var(--color-border));
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg);
  cursor: pointer;
  transition: all 180ms ease;
}
.member-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}

.member-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.member-avatar-sm {
  width: 28px;
  height: 28px;
  font-size: 10px;
}
.member-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-sub {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 180ms ease;
}
.member-row:first-of-type {
  border-top: 0;
}
.member-row:hover {
  background: var(--color-bg-subtle);
}
.member-row-role {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 1px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, #000 55%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 60px 20px 20px;
  z-index: 1000;
  overflow-y: auto;
}
.modal-card {
  width: 100%;
  max-width: 640px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.modal-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 180ms ease;
}
.modal-close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.modal-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.form-field-span-2 {
  grid-column: span 2;
}
.form-input-lg {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 180ms ease;
}
.form-input-lg:focus {
  border-color: var(--color-primary);
}
@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-field-span-2 {
    grid-column: span 1;
  }
}

/* ── Mobile (Phase 1A) ─────────────────────────────────────── */
.team-list-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.team-list-inner {
  min-width: 600px;
}

/* ── Empty State ───────────────────────────────────────────── */
.tv-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  color: var(--color-text-tertiary);
}
.tv-empty-icon {
  font-size: 32px;
  margin-bottom: 4px;
}
.tv-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0;
}
.tv-empty-sub {
  font-size: 12px;
  margin: 0;
  color: var(--color-text-tertiary);
}
.tv-empty-cta {
  margin-top: 8px;
  padding: 7px 16px;
  background: var(--color-text);
  color: var(--color-bg);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.tv-empty-cta:hover {
  opacity: 0.85;
}
</style>
