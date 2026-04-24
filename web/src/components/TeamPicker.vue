<script setup lang="ts">
// Wiederverwendbarer Team-Picker fuer Task- und Termin-Dialoge.
//
// Zwei Modi via mode-Prop:
//   - "single": Eine Person (Task-Assignee). Model ist string | null (UUID).
//   - "multi":  Mehrere Personen (Termin-Teilnehmer). Model ist string[] (UUIDs).
//
// Autocomplete ueber /team geladene Mitglieder, client-gefiltert.
// "Freitext"-Fallback: wenn ein Name getippt wird, der keinem Mitglied
// entspricht, kann er per Button als Freitext-Chip uebernommen werden
// (fuer Legacy-Namen oder externe Teilnehmer ohne Team-Eintrag).

import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import BIcon from "./BIcon.vue";

interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  memberType: string | null;
}

const props = defineProps<{
  mode: "single" | "multi";
  /** Gewählte Member-ID(s). single: string | null, multi: string[]. */
  modelValue: string | string[] | null;
  /** Zusätzliche Freitext-Assignees ohne Team-Match (nur multi-Mode).
   *  single-Mode hat keinen Freitext-Fallback — wenn nötig bitte ein
   *  separates Text-Input-Feld daneben bauen. */
  freeText?: string[];
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [string | string[] | null];
  "update:freeText": [string[]];
}>();

const members = ref<TeamMember[]>([]);
const query = ref("");
const showDropdown = ref(false);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    members.value = await api.get<TeamMember[]>("/team");
  } catch {
    members.value = [];
  } finally {
    loading.value = false;
  }
});

// Gewählte Member als Objekte (für Chips). Single ergibt 0 oder 1 Element,
// Multi ergibt entsprechend viele.
const selectedMembers = computed<TeamMember[]>(() => {
  if (props.mode === "single") {
    if (!props.modelValue || typeof props.modelValue !== "string") return [];
    const m = members.value.find((x) => x.id === props.modelValue);
    return m ? [m] : [];
  }
  const ids = Array.isArray(props.modelValue) ? props.modelValue : [];
  return ids
    .map((id) => members.value.find((m) => m.id === id))
    .filter((m): m is TeamMember => !!m);
});

// Kandidaten fürs Dropdown: nicht gewählte, gefiltert nach query.
const candidates = computed<TeamMember[]>(() => {
  const q = query.value.toLowerCase().trim();
  const selectedIds = new Set(selectedMembers.value.map((m) => m.id));
  let list = members.value.filter((m) => !selectedIds.has(m.id));
  if (q) {
    list = list.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.role?.toLowerCase().includes(q) ?? false),
    );
  }
  return list.slice(0, 8); // Maximal 8 im Dropdown, sonst scrollt's zu viel
});

// "Freitext hinzufuegen"-Option erscheint, wenn query nicht leer ist
// und keinem Mitglied entspricht. Nur im multi-Mode relevant.
const canAddFreeText = computed(() => {
  if (props.mode !== "multi") return false;
  const q = query.value.trim();
  if (!q) return false;
  const memberMatch = members.value.some((m) => m.name.toLowerCase() === q.toLowerCase());
  const freeMatch = (props.freeText ?? []).some((n) => n.toLowerCase() === q.toLowerCase());
  return !memberMatch && !freeMatch;
});

function selectMember(m: TeamMember) {
  if (props.mode === "single") {
    emit("update:modelValue", m.id);
  } else {
    const current = Array.isArray(props.modelValue) ? props.modelValue : [];
    emit("update:modelValue", [...current, m.id]);
  }
  query.value = "";
  showDropdown.value = false;
}

function removeMember(id: string) {
  if (props.mode === "single") {
    emit("update:modelValue", null);
  } else {
    const current = Array.isArray(props.modelValue) ? props.modelValue : [];
    emit(
      "update:modelValue",
      current.filter((x) => x !== id),
    );
  }
}

function addFreeText() {
  const q = query.value.trim();
  if (!q || props.mode !== "multi") return;
  emit("update:freeText", [...(props.freeText ?? []), q]);
  query.value = "";
  showDropdown.value = false;
}

function removeFreeText(name: string) {
  emit(
    "update:freeText",
    (props.freeText ?? []).filter((n) => n !== name),
  );
}

function onInputFocus() {
  showDropdown.value = true;
}
function onInputBlur() {
  // Kleines Delay, damit Click auf Dropdown-Item registriert wird bevor
  // wir zumachen.
  setTimeout(() => {
    showDropdown.value = false;
  }, 150);
}

watch(query, () => {
  if (query.value) showDropdown.value = true;
});
</script>

<template>
  <div class="team-picker" :class="{ 'team-picker-disabled': disabled }">
    <div class="team-picker-chips">
      <span v-for="m in selectedMembers" :key="m.id" class="picker-chip">
        <span>{{ m.name }}</span>
        <button class="picker-chip-x" @click="removeMember(m.id)" :title="'Entfernen'" type="button">
          <BIcon name="x" :size="10" />
        </button>
      </span>
      <span
        v-for="n in freeText ?? []"
        :key="'ft-' + n"
        class="picker-chip picker-chip-free"
        :title="'Freitext (kein Team-Mitglied)'"
      >
        <span>{{ n }}</span>
        <button class="picker-chip-x" @click="removeFreeText(n)" type="button">
          <BIcon name="x" :size="10" />
        </button>
      </span>
      <input
        v-if="mode === 'multi' || selectedMembers.length === 0"
        v-model="query"
        type="text"
        class="picker-input"
        :placeholder="placeholder ?? (mode === 'single' ? 'Person wählen…' : 'Hinzufügen…')"
        :disabled="disabled"
        @focus="onInputFocus"
        @blur="onInputBlur"
      />
    </div>
    <div v-if="showDropdown && (candidates.length > 0 || canAddFreeText || loading)" class="picker-dropdown">
      <div v-if="loading" class="picker-empty">Lade…</div>
      <button
        v-for="m in candidates"
        :key="m.id"
        type="button"
        class="picker-option"
        @mousedown.prevent="selectMember(m)"
      >
        <span class="picker-option-name">{{ m.name }}</span>
        <span v-if="m.role || m.memberType" class="picker-option-sub">
          <span v-if="m.role">{{ m.role }}</span>
          <span v-if="m.role && m.memberType"> · </span>
          <span v-if="m.memberType">{{ m.memberType }}</span>
        </span>
      </button>
      <button
        v-if="canAddFreeText"
        type="button"
        class="picker-option picker-option-free"
        @mousedown.prevent="addFreeText"
      >
        <BIcon name="plus" :size="10" />
        <span style="margin-left: 4px">"{{ query.trim() }}" als Freitext</span>
      </button>
      <div v-if="!loading && candidates.length === 0 && !canAddFreeText" class="picker-empty">
        Keine Treffer.
      </div>
    </div>
  </div>
</template>

<style scoped>
.team-picker {
  position: relative;
  min-width: 0;
}
.team-picker-disabled {
  opacity: 0.6;
  pointer-events: none;
}

.team-picker-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  min-height: 32px;
}
.team-picker-chips:focus-within {
  border-color: var(--color-primary);
}

.picker-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-text);
}
.picker-chip-free {
  border-style: dashed;
  color: var(--color-text-muted);
}
.picker-chip-x {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.picker-chip-x:hover {
  color: var(--color-danger-text);
  background: var(--color-bg);
}

.picker-input {
  flex: 1;
  min-width: 80px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--color-text);
  padding: 2px 4px;
}

.picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
}
.picker-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}
.picker-option:hover {
  background: var(--color-bg-subtle);
}
.picker-option-name {
  font-size: 12px;
  color: var(--color-text);
}
.picker-option-sub {
  font-size: 10px;
  color: var(--color-text-muted);
}
.picker-option-free {
  display: flex;
  flex-direction: row;
  align-items: center;
  color: var(--color-text-muted);
  font-size: 11px;
}
.picker-option-free:hover {
  color: var(--color-text);
}
.picker-empty {
  padding: 8px 10px;
  font-size: 11px;
  color: var(--color-text-faint);
  text-align: center;
}
</style>
