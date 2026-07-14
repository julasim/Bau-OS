<script setup lang="ts">
// ============================================================
// PATIO — Globaler Bestätigungs-Dialog
// ============================================================
// Ersetzt window.confirm() / window.alert(). Wird einmal in
// AppLayout gerendert; jede Komponente triggert via useConfirm().
// Singleton-State liegt in _pendingConfirm.
//
// alert()-Ersatz: confirm({ ..., cancelLabel: "" }) blendet den
// Cancel-Button aus → reiner OK-Dialog.
// ============================================================

import { onMounted, onUnmounted } from "vue";
import { _pendingConfirm, useConfirm } from "../composables/useConfirm";

const { _accept, _cancel } = useConfirm();

function onKeydown(e: KeyboardEvent) {
  if (!_pendingConfirm.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    _cancel();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="_pendingConfirm" class="confirm-overlay" @click.self="_cancel()">
    <div class="confirm-card" role="dialog" aria-modal="true">
      <h2 v-if="_pendingConfirm.title" class="confirm-title">
        {{ _pendingConfirm.title }}
      </h2>
      <div class="confirm-message">{{ _pendingConfirm.message }}</div>
      <div class="confirm-footer">
        <button v-if="_pendingConfirm.cancelLabel !== ''" type="button" class="patio-btn ghost" @click="_cancel()">
          {{ _pendingConfirm.cancelLabel || "Abbrechen" }}
        </button>
        <button
          type="button"
          class="patio-btn"
          :class="_pendingConfirm.confirmDanger ? 'danger' : 'solid'"
          @click="_accept()"
        >
          {{ _pendingConfirm.confirmLabel || "OK" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 20px;
}
.confirm-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  width: 100%;
  max-width: 420px;
  padding: 20px 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
}
.confirm-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}
.confirm-message {
  font-size: 14px;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.patio-btn.danger {
  background: #dc2626;
  color: #fff;
  border-color: #dc2626;
}
.patio-btn.danger:hover {
  opacity: 0.9;
}
</style>
