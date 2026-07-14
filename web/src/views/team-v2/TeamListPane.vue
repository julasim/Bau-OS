<script setup lang="ts">
// ============================================================
// PATIO Workspace v2 — TeamListPane
// ============================================================
// ListPane fuer Team. Filter nach Kategorie. Klick → /team/:id.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import ListPane from "../../components/shell/ListPane.vue";
import Avatar from "../../components/shell/Avatar.vue";
import BIcon from "../../components/BIcon.vue";

type MemberType = "Intern" | "Planer" | "Ausführende" | "Behörde" | "Lieferant" | "Bauherr";

interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  companyName: string | null;
  company: string | null;
  memberType: MemberType | null;
}

type Tab = "all" | "Intern" | "Planer" | "Ausführende" | "Behörde" | "Lieferant" | "Bauherr";

const route = useRoute();
const router = useRouter();
const members = ref<TeamMember[]>([]);
const search = ref("");
const tab = ref<Tab>("all");

const filtered = computed(() => {
  let r = members.value;
  if (tab.value !== "all") r = r.filter((m) => m.memberType === tab.value);
  if (search.value) {
    const q = search.value.toLowerCase();
    r = r.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.role?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        (m.companyName ?? m.company ?? "").toLowerCase().includes(q),
    );
  }
  return [...r].sort((a, b) => a.name.localeCompare(b.name, "de"));
});

const counts = computed(() => {
  const c: Record<string, number> = { all: members.value.length };
  for (const m of members.value) {
    const k = m.memberType ?? "—";
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
});

const activeId = computed(() => (route.params.id as string) ?? "");

function typeColor(t: MemberType | null): string {
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

function openMember(id: string) {
  router.push(`/team/${id}`);
}

async function load() {
  try {
    members.value = await api.get<TeamMember[]>("/team");
  } catch {
    members.value = [];
  }
}

// ── Create-Dialog ─────────────────────────────────────────────────────
const showCreate = ref(false);
const createSaving = ref(false);
const createError = ref<string | null>(null);
const createForm = ref({
  name: "",
  role: "",
  memberType: "",
  companyName: "",
  email: "",
  phone: "",
});

function openCreate() {
  showCreate.value = true;
  createError.value = null;
  createForm.value = { name: "", role: "", memberType: "", companyName: "", email: "", phone: "" };
}

async function submitCreate() {
  const name = createForm.value.name.trim();
  if (!name || createSaving.value) return;
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
    const created = await api.post<{ id: string }>("/team", payload);
    showCreate.value = false;
    await load();
    router.push(`/team/${encodeURIComponent(created.id)}`);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    createSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <ListPane
    title="Team"
    :count="counts.all"
    searchable
    search-placeholder="Mitglieder filtern…"
    :model-value="search"
    @update:model-value="search = $event"
    :tabs="[
      { id: 'all', label: `Alle ${counts.all}` },
      { id: 'Intern', label: `Intern ${counts.Intern ?? 0}` },
      { id: 'Planer', label: `Planer ${counts.Planer ?? 0}` },
      { id: 'Ausführende', label: `Ausf. ${counts['Ausführende'] ?? 0}` },
      { id: 'Bauherr', label: `Bauherr ${counts.Bauherr ?? 0}` },
    ]"
    :active-tab="tab"
    @tab-change="tab = $event as Tab"
  >
    <template #action>
      <button class="v2-icon-btn" title="Neues Mitglied" @click="openCreate">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </template>

    <button
      v-for="m in filtered"
      :key="m.id"
      class="list-item"
      :data-active="m.id === activeId"
      @click="openMember(m.id)"
    >
      <div class="li-top" style="align-items: center; gap: 10px">
        <Avatar :name="m.name" :color="typeColor(m.memberType)" :size="24" />
        <span class="li-title">{{ m.name }}</span>
      </div>
      <div v-if="m.role || m.companyName || m.company" class="li-meta" style="margin-left: 34px">
        <span v-if="m.role">{{ m.role }}</span>
        <span v-if="m.role && (m.companyName || m.company)">·</span>
        <span v-if="m.companyName || m.company">{{ m.companyName ?? m.company }}</span>
      </div>
    </button>

    <div v-if="filtered.length === 0" class="empty-state">
      <template v-if="search">
        <div class="empty-icon"><BIcon name="search" :size="24" /></div>
        <p class="empty-title">Keine Treffer</p>
        <p class="empty-sub">Keine Mitglieder für „{{ search }}"</p>
      </template>
      <template v-else>
        <div class="empty-icon"><BIcon name="users" :size="24" /></div>
        <p class="empty-title">Noch keine Mitglieder</p>
        <p class="empty-sub">Lege dein erstes Team-Mitglied an um loszulegen.</p>
        <button class="empty-cta" @click="openCreate">+ Erstes Mitglied</button>
      </template>
    </div>
  </ListPane>

  <!-- Create-Modal -->
  <div v-if="showCreate" class="create-overlay" @click.self="showCreate = false">
    <div class="create-card">
      <h3 style="margin: 0 0 12px; font-size: 15px; font-weight: 600">Neues Team-Mitglied</h3>
      <div style="display: flex; flex-direction: column; gap: 10px">
        <input v-model="createForm.name" placeholder="Name *" class="create-input" @keyup.enter="submitCreate" />
        <input v-model="createForm.role" placeholder="Rolle (z.B. Architekt)" class="create-input" />
        <select v-model="createForm.memberType" class="create-input">
          <option value="">— Kategorie —</option>
          <option value="Intern">Intern</option>
          <option value="Planer">Planer</option>
          <option value="Ausführende">Ausführende</option>
          <option value="Behörde">Behörde</option>
          <option value="Lieferant">Lieferant</option>
          <option value="Bauherr">Bauherr</option>
        </select>
        <input v-model="createForm.companyName" placeholder="Firma" class="create-input" />
        <input v-model="createForm.email" placeholder="Email" type="email" class="create-input" />
        <input v-model="createForm.phone" placeholder="Telefon" class="create-input" />
      </div>
      <div v-if="createError" style="margin-top: 8px; color: var(--status-error); font-size: 12px">
        {{ createError }}
      </div>
      <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end">
        <button class="v2-btn" :disabled="createSaving" @click="showCreate = false">Abbrechen</button>
        <button
          class="v2-btn v2-btn-primary"
          :disabled="!createForm.name.trim() || createSaving"
          :style="{ opacity: !createForm.name.trim() || createSaving ? 0.5 : 1 }"
          @click="submitCreate"
        >
          {{ createSaving ? "Speichert…" : "Anlegen" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.create-card {
  background: var(--bg-app);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 20px;
  width: 100%;
  max-width: 420px;
  margin: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
}
.create-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-app);
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
}
.create-input:focus {
  border-color: var(--accent);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  color: var(--fg-muted);
}
.empty-icon {
  font-size: 32px;
  margin-bottom: 4px;
}
.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-secondary);
  margin: 0;
}
.empty-sub {
  font-size: 12px;
  margin: 0;
}
.empty-cta {
  margin-top: 8px;
  padding: 7px 16px;
  background: var(--fg-primary);
  color: var(--bg-app);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.empty-cta:hover {
  opacity: 0.85;
}
</style>
