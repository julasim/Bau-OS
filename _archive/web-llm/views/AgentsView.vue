<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

interface FileInfo {
  name: string;
  chars: number;
  tokens: number;
  loaded: boolean;
}

const router = useRouter();
const agents = ref<string[]>([]);
const selectedAgent = ref("");
const files = ref<FileInfo[]>([]);

async function loadAgents() {
  agents.value = await api.get<string[]>("/agents");
  if (agents.value.length > 0) selectAgent(agents.value[0]);
}

async function selectAgent(name: string) {
  selectedAgent.value = name;
  files.value = await api.get<FileInfo[]>(`/agents/${encodeURIComponent(name)}`);
}

function openFile(filename: string) {
  router.push(`/agents/${encodeURIComponent(selectedAgent.value)}/${encodeURIComponent(filename)}`);
}

onMounted(loadAgents);
</script>

<template>
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <div style="margin-bottom: 20px">
      <div class="eyebrow" style="margin-bottom: 6px">System</div>
      <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Agenten</h1>
      <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
        {{ agents.length }} Agent{{ agents.length !== 1 ? "en" : "" }} verfügbar
      </p>
    </div>

    <div class="grid agents-grid" style="grid-template-columns: 280px 1fr; gap: 20px">
      <!-- Agent-Liste -->
      <div class="flex flex-col" style="gap: 6px">
        <div
          v-for="name in agents"
          :key="name"
          @click="selectAgent(name)"
          :class="['agent-card', selectedAgent === name ? 'agent-card-active' : '']"
        >
          <div
            style="
              width: 32px;
              height: 32px;
              border-radius: 6px;
              background: var(--color-border-subtle);
              display: inline-flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
            "
          >
            <BIcon name="cpu" :size="16" style="color: var(--color-text-muted)" />
          </div>
          <div class="min-w-0">
            <div style="font-size: 13px; font-weight: 500; color: var(--color-text)" class="truncate">
              {{ name }}
            </div>
            <div
              class="flex items-center"
              style="gap: 6px; font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
            >
              <span style="width: 6px; height: 6px; border-radius: 9999px; background: var(--color-success)" />
              aktiv
            </div>
          </div>
        </div>
        <p
          v-if="agents.length === 0"
          style="font-size: 12px; color: var(--color-text-tertiary); padding: 20px 0; text-align: center"
        >
          Keine Agenten vorhanden.
        </p>
      </div>

      <!-- Detail -->
      <div
        v-if="selectedAgent"
        style="border: 1px solid var(--color-border); border-radius: 8px; padding: 20px; background: var(--color-bg)"
      >
        <div class="flex items-center" style="gap: 12px; margin-bottom: 20px">
          <div
            style="
              width: 48px;
              height: 48px;
              border-radius: 8px;
              background: var(--color-border-subtle);
              display: inline-flex;
              align-items: center;
              justify-content: center;
            "
          >
            <BIcon name="cpu" :size="24" style="color: var(--color-text-muted)" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 style="font-size: 18px; font-weight: 600; color: var(--color-text); margin: 0">
              {{ selectedAgent }}
            </h2>
            <div style="font-size: 12px; color: var(--color-text-muted); margin-top: 2px">
              {{ files.length }} Workspace-Dateien
            </div>
          </div>
          <span
            class="pill"
            style="
              background: var(--color-success-bg);
              color: var(--color-success-text);
              border: 1px solid var(--color-success-border);
              padding: 2px 10px;
              border-radius: 9999px;
              font-size: 10px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            "
          >
            online
          </span>
        </div>

        <div class="eyebrow" style="margin-bottom: 8px">Workspace-Dateien</div>
        <div style="border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden">
          <div
            v-for="f in files"
            :key="f.name"
            @click="openFile(f.name)"
            class="agent-file-row flex items-center justify-between"
            style="gap: 12px; padding: 10px 14px; border-top: 1px solid var(--color-border-subtle)"
          >
            <div class="flex items-center" style="gap: 8px">
              <BIcon name="file" :size="14" style="color: var(--color-text-muted)" />
              <span class="font-mono" style="font-size: 12px; color: var(--color-text)">
                {{ f.name }}
              </span>
            </div>
            <span class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary)">
              {{ f.chars }} Z · {{ f.tokens }} T
            </span>
          </div>
          <p
            v-if="files.length === 0"
            style="font-size: 12px; color: var(--color-text-tertiary); text-align: center; padding: 24px"
          >
            Keine Dateien.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  cursor: pointer;
  transition: all 180ms ease;
}
.agent-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}
.agent-card-active {
  border-color: var(--color-primary);
  background: var(--color-bg-subtle);
}
.agent-file-row {
  cursor: pointer;
  transition: background 180ms ease;
}
.agent-file-row:first-child {
  border-top: 0 !important;
}
.agent-file-row:hover {
  background: var(--color-bg-subtle);
}

/* ── Mobile: 2-Spalter (Sidebar + Detail) → 1-Spalter ─── */
@media (max-width: 767.98px) {
  .agents-grid {
    grid-template-columns: 1fr !important;
  }
}
</style>
