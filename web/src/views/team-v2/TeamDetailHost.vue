<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — TeamDetailHost
// ============================================================
// Wrappt das bestehende TeamDetailView (1100+ Zeilen, schon gut
// ausgebaut) im DetailPane-Slot. Bei /team ohne :id zeigt Empty-State.
// ============================================================

import { computed, defineAsyncComponent } from "vue";
import { useRoute } from "vue-router";
import DetailPane from "../../components/shell/DetailPane.vue";
import BIcon from "../../components/BIcon.vue";

const TeamDetailView = defineAsyncComponent(() => import("../TeamDetailView.vue"));

const route = useRoute();
const memberId = computed(() => (route.params.id as string) ?? "");
</script>

<template>
  <DetailPane v-if="!memberId" padding="default">
    <template #crumb>
      <span class="here">Team</span>
    </template>
    <div
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
      <BIcon name="users" :size="32" />
      <div style="font-size: 14px">Wähle ein Team-Mitglied aus der Liste links</div>
      <div style="font-size: 12px; color: var(--fg-subtle)">
        Filter oben nach Kategorie (Intern, Planer, Ausführende, Bauherr…)
      </div>
    </div>
  </DetailPane>
  <!-- TeamDetailView bringt eigenen Wrapper + Padding mit. Wir rendern es
       direkt ohne DetailPane-Topbar — die View hat eigenen Hero. -->
  <div v-else class="pane-detail" style="overflow: auto; min-height: 0">
    <TeamDetailView />
  </div>
</template>
