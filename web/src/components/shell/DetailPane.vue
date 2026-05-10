<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — Detail-Pane (1fr)
// ============================================================
// Rechte Spalte (Bühne). Topbar mit Breadcrumb + Actions oben,
// Body unten. Padding-Modus über `padding="default|tight|none"`.
// ============================================================

defineProps<{
  /** Padding-Mode des Bodys. Default = 32px (compact 24px). */
  padding?: "default" | "tight" | "none";
}>();
</script>

<template>
  <main class="pane-detail">
    <header class="detail-topbar">
      <div class="crumb">
        <slot name="crumb" />
      </div>
      <div class="actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="detail-body" :data-padding="padding ?? 'default'">
      <slot />
    </div>
  </main>
</template>
