<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — TeamListPane
// ============================================================
// ListPane fuer Team. Filter nach Kategorie. Klick → /team/:id.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import ListPane from "../../components/shell/ListPane.vue";
import Avatar from "../../components/shell/Avatar.vue";

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

    <div
      v-if="filtered.length === 0"
      style="padding: 32px 16px; text-align: center; font-size: 12px; color: var(--fg-muted)"
    >
      <span v-if="search">Keine Treffer für „{{ search }}"</span>
      <span v-else>Noch keine Team-Mitglieder.</span>
    </div>
  </ListPane>
</template>
