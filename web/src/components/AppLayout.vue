<script setup lang="ts">
// ============================================================
// PATIO Workspace v2 — App-Shell (Phase 7c)
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

import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import NavRail from "./shell/NavRail.vue";
import AppTopbar from "./shell/AppTopbar.vue";
import SystemStatusBanner from "./SystemStatusBanner.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import BIcon from "./BIcon.vue";
import { useWorkspaceShell } from "../composables/useWorkspaceShell";
import { connectionError } from "../composables/useEvents";

const route = useRoute();
const { state, railMobileOpen, toggleRailMobile, closeRailMobile, listMobileOpen, toggleListMobile, closeListMobile } =
  useWorkspaceShell();

// Beim Navigieren BEIDE Mobile-Overlays schliessen, sonst bleiben sie nach
// der Auswahl offen ueber dem Inhalt liegen.
watch(
  () => route.fullPath,
  () => {
    closeRailMobile();
    closeListMobile();
  },
);

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
    :data-rail-mobile-open="railMobileOpen"
    :data-list-mobile-open="listMobileOpen"
  >
    <!-- Mobile-Hamburger: oeffnet die NavRail als Overlay (<=768px).
         Auf Desktop via CSS ausgeblendet. -->
    <button type="button" class="mobile-nav-toggle" aria-label="Navigation oeffnen" @click="toggleRailMobile">
      <BIcon name="grid" :size="20" />
    </button>
    <!-- Zweiter Umschalter: oeffnet die Listenspalte als Overlay (<=768px) —
         nur auf Routen, die ueberhaupt eine mitbringen. -->
    <button
      v-if="hasListPane"
      type="button"
      class="mobile-list-toggle"
      aria-label="Liste oeffnen"
      @click="toggleListMobile"
    >
      <BIcon name="list" :size="20" />
    </button>
    <!-- Backdrop hinter dem Rail-Overlay; Tap schliesst. -->
    <div v-if="railMobileOpen" class="mobile-nav-backdrop" @click="closeRailMobile"></div>
    <!-- Backdrop hinter dem Listen-Overlay; Tap schliesst. -->
    <div v-if="listMobileOpen" class="mobile-nav-backdrop" @click="closeListMobile"></div>
    <NavRail />
    <router-view v-if="hasListPane" name="listpane" />
    <!-- Inhaltsspalte: die globale Leiste sitzt HIER, nicht als Grid-Zeile
         ueber allem — sonst waeren Navigations- und Listenspalte nicht mehr
         voll hoch. Darunter der scrollende Koerper. -->
    <section class="app-content">
      <AppTopbar />
      <div class="app-content-body">
        <!-- v2-Ansichten rendern ihr <DetailPane> selbst. -->
        <router-view v-if="hasListPane" />
        <!-- Vollbreite Altbestands-Ansichten: eigener Scroll-Container. -->
        <main v-else class="legacy-detail">
          <router-view />
        </main>
      </div>
    </section>
    <!-- System-Status (Backend-Down/JWT-Expired) als Top-Banner ueber allem -->
    <SystemStatusBanner />
    <!-- SSE-Verbindungsabbruch nach MAX_RECONNECT_ATTEMPTS -->
    <div v-if="connectionError" class="connection-error-banner" role="alert">
      <span>{{ connectionError }}</span>
      <button type="button" @click="connectionError = null" aria-label="Schliessen">×</button>
    </div>
    <ConfirmDialog />
  </div>
</template>

<style scoped>
/* Inhaltsspalte als Grid-Kind: Leiste oben (fest) + Koerper darunter, der
   die Hoehe fuellt und intern scrollt. */
.app-content {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--detail-bg, var(--bg-app));
}
.app-content-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;
}
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
