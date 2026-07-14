<script setup lang="ts">
// ============================================================
// PATIO Workspace v2 — ProjectDetailHost
// ============================================================
// Wrappt das bestehende ProjectDetailView (4000+ Zeilen, hat
// eigene Inner-Sidebar mit allen Modulen) im DetailPane-Slot.
// Bei /projects ohne :name zeigt Empty-State.
// ============================================================

import { computed, defineAsyncComponent } from "vue";
import { useRoute } from "vue-router";
import DetailPane from "../../components/shell/DetailPane.vue";
import BIcon from "../../components/BIcon.vue";

const ProjectDetailView = defineAsyncComponent(() => import("../ProjectDetailView.vue"));

const route = useRoute();
const projectName = computed(() => decodeURIComponent((route.params.name as string) ?? ""));
</script>

<template>
  <DetailPane v-if="!projectName">
    <template #crumb>
      <span class="here">Projekte</span>
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
      <BIcon name="folder" :size="32" />
      <div style="font-size: 14px">Wähle ein Projekt aus der Liste links</div>
      <div style="font-size: 12px; color: var(--fg-subtle)">Tabs oben filtern aktiv vs. alle</div>
    </div>
  </DetailPane>
  <!-- ProjectDetailView bringt eigenen Wrapper mit + alle Module-Tabs.
       Wir geben ihm einfach den vollen DetailPane-Slot. -->
  <div v-else class="pane-detail" style="overflow: auto; min-height: 0">
    <ProjectDetailView />
  </div>
</template>
