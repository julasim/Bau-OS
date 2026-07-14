<script setup lang="ts">
// ============================================================
// PATIO Workspace v2 — List-Pane (320px)
// ============================================================
// Mittlere Spalte des 3-Spalten-Shells. Kontextueller Index der
// aktuellen Sektion: Liste, Tabs, Such-Input, Action-Slot.
//
// Slots:
//   default       — Body (List-Items vom Konsumenten gerendert)
//   action        — Button rechts neben dem Titel (z.B. + Neu)
// Props:
//   title, count, searchPlaceholder, modelValue (search-string),
//   tabs: [{ id, label }], activeTab, @tabChange
// ============================================================

defineProps<{
  title: string;
  count?: number | string;
  searchable?: boolean;
  searchPlaceholder?: string;
  modelValue?: string;
  tabs?: { id: string; label: string }[];
  activeTab?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "tabChange", id: string): void;
}>();

function onSearchInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
}
</script>

<template>
  <aside class="pane-list">
    <div class="pane-list-header">
      <div class="row">
        <h2>{{ title }}</h2>
        <span v-if="count !== undefined" class="count">{{ count }}</span>
        <div style="flex: 1"></div>
        <slot name="action" />
      </div>
      <div v-if="searchable" class="pane-list-search">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input :value="modelValue ?? ''" :placeholder="searchPlaceholder ?? 'Suchen…'" @input="onSearchInput" />
      </div>
    </div>
    <div v-if="tabs && tabs.length > 0" class="pane-list-tabs">
      <button v-for="t in tabs" :key="t.id" :data-active="activeTab === t.id" @click="emit('tabChange', t.id)">
        {{ t.label }}
      </button>
    </div>
    <div class="pane-list-body">
      <slot />
    </div>
  </aside>
</template>
