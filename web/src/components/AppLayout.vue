<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — App-Shell (Phase 7c)
// ============================================================
// Drei-Spalten-Layout (NavRail 56px + ListPane 320px + Detail 1fr).
// Routing via vue-router Named-Views:
//   - Routes mit ListPane: components: { listpane: …, default: … }
//   - Routes ohne ListPane: components: { default: … } → ListPane
//     wird via data-no-list="true" auf 2-Spalten-Grid kollabiert.
//
// Bestehende (unmigrated) Views werden im "legacy-detail"-Wrapper
// gerendert mit eigenem overflow + min-height:0 — sie behalten ihre
// inline padding/max-width, brechen aber nicht durch fehlende
// Scroll-Container.
// ============================================================

import { computed } from "vue";
import { useRoute } from "vue-router";
import NavRail from "./shell/NavRail.vue";
import SystemStatusBanner from "./SystemStatusBanner.vue";
import { useWorkspaceShell } from "../composables/useWorkspaceShell";
import { connectionError } from "../composables/useEvents";

const route = useRoute();
const { state } = useWorkspaceShell();

/** True wenn die aktuelle Route eine 'listpane'-Komponente definiert.
 *  Sonst → kein ListPane, full-width DetailPane. */
const hasListPane = computed(() => {
  return route.matched.some((r) => r.components && Object.prototype.hasOwnProperty.call(r.components, "listpane"));
});

/** ChatView hat ein eigenes Sidebar-Layout (260px Liste links). Sie
 *  braucht keinen Wrapper mit padding/overflow:auto — sonst doppelt
 *  Scroll-Container. Wir rendern sie direkt ins Grid. */
const isChatRoute = computed(() => route.name === "chat");
</script>

<template>
  <div
    class="app-v2"
    :data-variant="state.variant"
    :data-density="state.density"
    :data-rail-collapsed="state.railCollapsed"
    :data-list-collapsed="state.listCollapsed"
    :data-no-list="!hasListPane"
  >
    <NavRail />
    <router-view name="listpane" v-if="hasListPane" />
    <!-- Chat: rendert sich selbst auf volle Hoehe ohne Wrapper. -->
    <router-view v-if="isChatRoute" />
    <!-- Migrated v2-Views: rendern <DetailPane> selbst. -->
    <router-view v-else-if="hasListPane" />
    <!-- Legacy Full-Width-Views: brauchen Wrapper mit overflow + min-h-0,
         damit ihre eigenen Inhalte scrollen statt clipped zu werden. -->
    <main v-else class="legacy-detail">
      <router-view />
    </main>
    <!-- System-Status (Backend-Down/JWT-Expired) als Top-Banner ueber allem -->
    <SystemStatusBanner />
    <!-- SSE-Verbindungsabbruch nach MAX_RECONNECT_ATTEMPTS -->
    <div v-if="connectionError" class="connection-error-banner" role="alert">
      <span>{{ connectionError }}</span>
      <button type="button" @click="connectionError = null" aria-label="Schliessen">×</button>
    </div>
  </div>
</template>

<style scoped>
.legacy-detail {
  background: var(--bg-app);
  min-height: 0;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
/* SystemStatusBanner schwebt als Top-Banner ueber allem. */
:deep(.system-status-banner) {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
}
.connection-error-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 101;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 24px;
  font-size: 12px;
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-bottom: 1px solid var(--color-warning-border);
}
.connection-error-banner button {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.6;
}
</style>
