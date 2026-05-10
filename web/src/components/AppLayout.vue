<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — App-Shell (Phase 7c)
// ============================================================
// Drei-Spalten-Layout (NavRail 56px + ListPane 320px + Detail 1fr).
// Routing via vue-router Named-Views:
//   - Routes mit ListPane: components: { listpane: …, default: … }
//   - Routes ohne ListPane: components: { default: … } → ListPane
//     wird via data-no-list="true" ausgeblendet.
//
// Bestehende Routes ohne ListPane-Komponente laufen weiter als
// full-width DetailPane (Backward-Compat — ein Migrations-Schritt
// pro View).
// ============================================================

import { computed } from "vue";
import { useRoute } from "vue-router";
import NavRail from "./shell/NavRail.vue";
import SystemStatusBanner from "./SystemStatusBanner.vue";
import { useWorkspaceShell } from "../composables/useWorkspaceShell";

const route = useRoute();
const { state } = useWorkspaceShell();

/** True wenn die aktuelle Route eine 'listpane'-Komponente definiert.
 *  Sonst → kein ListPane, full-width DetailPane. */
const hasListPane = computed(() => {
  return route.matched.some((r) => r.components && Object.prototype.hasOwnProperty.call(r.components, "listpane"));
});
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
    <router-view />
    <!-- System-Status (Backend-Down/JWT-Expired) als Notification ueber allem -->
    <SystemStatusBanner />
  </div>
</template>

<style scoped>
/* SystemStatusBanner soll im neuen Shell als Top-Banner ueber allem schweben */
:deep(.system-status-banner) {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
}
</style>
