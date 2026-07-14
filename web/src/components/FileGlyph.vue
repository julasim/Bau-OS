<script setup lang="ts">
// ============================================================
// PATIO — Datei-Glyphen (PATIO-Stil, flach, Mono-Stroke)
// ============================================================
// Drei Groessen:
//   - small: 14×16 (in Listen-Reihen, Spalten-Browser)
//   - large: 32×40 + .ext-Label drunter (Symbole-View)
//   - hero:  56×68 + .ext-Label drunter (Preview-Pane)
//
// Folder ist ein eigener Pfad (klassisches Folder-Outline).
// Files sind alle dasselbe Page-mit-Eselsohr-Outline — die Kind-
// Information kommt rein ueber das monospace .ext-Label, niemals
// ueber farbige Badges oder kind-spezifische Icons.
// ============================================================

import { computed } from "vue";

type Kind = "root" | "folder" | "pdf" | "dwg" | "image" | "doc" | "csv" | "archive" | "code" | "other";
type Size = "small" | "large" | "hero";

const props = withDefaults(
  defineProps<{
    kind: Kind;
    size?: Size;
    active?: boolean;
  }>(),
  { size: "small", active: false },
);

const ext = computed<string>(() => {
  return (
    (
      {
        pdf: "pdf",
        dwg: "dwg",
        image: "img",
        doc: "doc",
        csv: "csv",
        archive: "gz",
        code: "md",
      } as Record<string, string>
    )[props.kind] ?? "file"
  );
});

const folderSize = computed(() => (props.size === "hero" ? 64 : props.size === "large" ? 36 : 16));
</script>

<template>
  <!-- Folder -->
  <svg
    v-if="kind === 'folder'"
    :width="folderSize"
    :height="folderSize * 0.82"
    viewBox="0 0 24 20"
    fill="none"
    :stroke="active ? '#FFFFFF' : 'currentColor'"
    :stroke-width="size === 'hero' ? 1 : 1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="flex-shrink: 0"
  >
    <path d="M2 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
  </svg>

  <!-- File hero (56×68 + label) -->
  <div v-else-if="size === 'hero'" style="display: flex; flex-direction: column; align-items: center; gap: 10px">
    <svg
      width="56"
      height="68"
      viewBox="0 0 56 68"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 4 H38 L52 18 V62 a2 2 0 0 1-2 2 H6 a2 2 0 0 1-2-2 V6 a2 2 0 0 1 2-2 z" />
      <path d="M38 4 V16 a2 2 0 0 0 2 2 H52" />
    </svg>
    <span
      style="
        font-size: 11px;
        font-family: &quot;JetBrains Mono&quot;, monospace;
        color: var(--color-text-muted);
        letter-spacing: 0.12em;
        text-transform: uppercase;
      "
    >
      .{{ ext }}
    </span>
  </div>

  <!-- File large (32×40 + label) -->
  <div v-else-if="size === 'large'" style="display: flex; flex-direction: column; align-items: center; gap: 6px">
    <svg
      width="32"
      height="40"
      viewBox="0 0 56 68"
      fill="none"
      :stroke="active ? '#FFFFFF' : 'currentColor'"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 4 H38 L52 18 V62 a2 2 0 0 1-2 2 H6 a2 2 0 0 1-2-2 V6 a2 2 0 0 1 2-2 z" />
      <path d="M38 4 V16 a2 2 0 0 0 2 2 H52" />
    </svg>
    <span
      style="
        font-size: 9px;
        font-family: &quot;JetBrains Mono&quot;, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      "
      :style="{ color: active ? 'rgba(255,255,255,0.6)' : 'var(--color-text-tertiary)' }"
    >
      .{{ ext }}
    </span>
  </div>

  <!-- File small (14×16, inline) -->
  <svg
    v-else
    width="14"
    height="16"
    viewBox="0 0 56 68"
    fill="none"
    :stroke="active ? '#FFFFFF' : 'var(--color-text-tertiary)'"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="flex-shrink: 0"
  >
    <path d="M4 4 H38 L52 18 V62 a2 2 0 0 1-2 2 H6 a2 2 0 0 1-2-2 V6 a2 2 0 0 1 2-2 z" />
    <path d="M38 4 V16 a2 2 0 0 0 2 2 H52" />
  </svg>
</template>
