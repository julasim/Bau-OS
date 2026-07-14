<script setup lang="ts">
// ============================================================
// PATIO Workspace v2 — NoteDetail
// ============================================================
// Rechte Spalte (DetailPane) der Notizen-Section. Zeigt Empty-State
// wenn route.params.name fehlt, sonst Editor + Preview-Toggle.
// ============================================================

import { ref, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import DetailPane from "../../components/shell/DetailPane.vue";
import MarkdownRenderer from "../../components/MarkdownRenderer.vue";
import BIcon from "../../components/BIcon.vue";
import { useConfirm } from "../../composables/useConfirm";

const { confirm } = useConfirm();
const route = useRoute();
const router = useRouter();
const content = ref("");
const dirtyContent = ref(""); // letzter gespeicherter Stand — fuer Dirty-Tracking
const saving = ref(false);
const loading = ref(false);
const preview = ref(false);
const error = ref<string | null>(null);

const noteName = computed(() => (route.params.name as string) ?? "");
const isDirty = computed(() => content.value !== dirtyContent.value);

async function loadNote(name: string) {
  if (!name) {
    content.value = "";
    dirtyContent.value = "";
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const note = await api.get<{ name: string; content: string }>(`/notes/${encodeURIComponent(name)}`);
    content.value = note.content;
    dirtyContent.value = note.content;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Notiz konnte nicht geladen werden";
    content.value = "";
    dirtyContent.value = "";
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!noteName.value || saving.value) return;
  saving.value = true;
  try {
    await api.put(`/notes/${encodeURIComponent(noteName.value)}`, { content: content.value });
    dirtyContent.value = content.value;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    saving.value = false;
  }
}

async function deleteNote() {
  if (!noteName.value) return;
  if (!(await confirm({ message: `Notiz „${noteName.value}" wirklich löschen?`, confirmDanger: true }))) return;
  try {
    await api.delete(`/notes/${encodeURIComponent(noteName.value)}`);
    router.push("/notes");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

// Strg+S → speichern
function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    void save();
  }
}

watch(
  noteName,
  (n) => {
    void loadNote(n);
  },
  { immediate: true },
);
</script>

<template>
  <DetailPane>
    <template #crumb>
      <span class="sep">Notizen</span>
      <template v-if="noteName">
        <span class="sep">/</span>
        <span class="here">{{ noteName }}</span>
        <span v-if="isDirty" style="color: var(--status-progress); margin-left: 4px" title="Ungespeicherte Änderungen"
          >●</span
        >
      </template>
    </template>

    <template #actions v-if="noteName">
      <button class="v2-btn" @click="preview = !preview">
        <BIcon :name="preview ? 'edit' : 'eye'" :size="14" />
        {{ preview ? "Bearbeiten" : "Vorschau" }}
      </button>
      <button class="v2-icon-btn" title="Löschen" @click="deleteNote">
        <BIcon name="trash" :size="14" />
      </button>
      <button
        class="v2-btn v2-btn-primary"
        :disabled="saving || !isDirty"
        :style="{ opacity: saving || !isDirty ? 0.5 : 1 }"
        @click="save"
      >
        {{ saving ? "Speichert…" : "Speichern" }}
      </button>
    </template>

    <!-- Empty-State: keine Notiz ausgewählt -->
    <div
      v-if="!noteName"
      style="
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: var(--fg-muted);
      "
    >
      <BIcon name="edit" :size="32" />
      <div style="font-size: 14px">Wähle eine Notiz aus der Liste links</div>
      <div style="font-size: 12px; color: var(--fg-subtle)">oder lege mit + eine neue an</div>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" style="padding: 40px; text-align: center; color: var(--fg-muted)">Lade…</div>

    <!-- Error -->
    <div
      v-else-if="error"
      style="
        padding: 12px 16px;
        background: var(--status-error-bg);
        color: var(--status-error);
        border: 1px solid var(--status-error);
        border-radius: 6px;
      "
    >
      {{ error }}
    </div>

    <!-- Preview -->
    <div v-else-if="preview" class="note-doc" style="max-width: 760px; margin: 0 auto">
      <MarkdownRenderer :content="content" />
    </div>

    <!-- Editor -->
    <textarea
      v-else
      v-model="content"
      class="font-mono"
      style="
        width: 100%;
        min-height: calc(100vh - 200px);
        padding: 16px 20px;
        border: 1px solid var(--border-default);
        border-radius: 8px;
        background: var(--bg-app);
        color: var(--fg-primary);
        font-size: 13px;
        line-height: 1.65;
        resize: vertical;
        outline: none;
      "
      @keydown="onKeyDown"
    />
  </DetailPane>
</template>
