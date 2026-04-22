<script setup lang="ts">
import { computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { clearToken } from "../api";
import { useTheme } from "../composables/useTheme";
import { useSidebar } from "../composables/useSidebar";
import { useCurrentUser } from "../composables/useCurrentUser";
import BIcon from "./BIcon.vue";

const router = useRouter();
const route = useRoute();
const { theme, toggle } = useTheme();
const { open, close } = useSidebar();
const { displayName, initials, role } = useCurrentUser();

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
  kbd?: string;
}
interface NavSection {
  title?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: "grid" },
      { to: "/chat", label: "Chat", icon: "message" },
    ],
  },
  {
    title: "Arbeit",
    items: [
      { to: "/tasks", label: "Aufgaben", icon: "check" },
      { to: "/calendar", label: "Kalender", icon: "calendar" },
      { to: "/projects", label: "Projekte", icon: "folder" },
    ],
  },
  {
    title: "Inhalte",
    items: [
      { to: "/notes", label: "Notizen", icon: "file" },
      { to: "/files", label: "Dateien", icon: "archive" },
      { to: "/search", label: "Suche", icon: "search" },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/agents", label: "Agenten", icon: "cpu" },
      { to: "/settings", label: "Einstellungen", icon: "settings" },
    ],
  },
];

const currentPath = computed(() => route.path);

function isActive(to: string): boolean {
  if (to === "/") return currentPath.value === "/";
  return currentPath.value.startsWith(to);
}

function logout() {
  clearToken();
  router.push("/login");
}

function onNavClick() {
  // Auf Mobile beim Klick auf einen Nav-Link den Drawer schliessen.
  if (typeof window !== "undefined" && window.innerWidth < 1024) {
    close();
  }
}
</script>

<template>
  <!-- Backdrop (nur auf Mobile sichtbar, wenn offen) -->
  <div
    v-if="open"
    class="sidebar-backdrop"
    @click="close"
    aria-hidden="true"
  />

  <aside
    :class="['sidebar-root flex flex-col flex-shrink-0', open ? 'sidebar-open' : 'sidebar-closed']"
    style="
      width: 240px;
      background: var(--color-bg-subtle);
      border-right: 1px solid var(--color-border);
    "
  >
    <!-- Logo -->
    <div
      class="flex items-center gap-2.5"
      style="padding: 16px 20px; border-bottom: 1px solid var(--color-border)"
    >
      <div
        class="flex items-center justify-center font-semibold"
        style="
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: #111827;
          color: #fff;
          font-size: 13px;
          letter-spacing: -0.02em;
        "
      >
        B
      </div>
      <div class="leading-tight">
        <div style="color: var(--color-text); font-size: 14px; font-weight: 600; line-height: 1.2">
          Bau-OS
        </div>
        <div class="eyebrow" style="margin-top: 2px">Workspace</div>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 overflow-y-auto" style="padding: 12px 8px">
      <div v-for="(section, si) in sections" :key="si" :style="si > 0 ? { marginTop: '18px' } : {}">
        <div v-if="section.title" class="eyebrow" style="padding: 0 12px; margin-bottom: 6px">
          {{ section.title }}
        </div>
        <router-link
          v-for="item in section.items"
          :key="item.to"
          :to="item.to"
          @click="onNavClick"
          :class="[
            'nav-item group flex items-center gap-2.5 rounded-[6px] text-[13px] relative',
            isActive(item.to) ? 'nav-item-active' : 'nav-item-idle',
          ]"
          style="padding: 6px 12px; text-decoration: none"
        >
          <span
            v-if="isActive(item.to)"
            style="
              position: absolute;
              left: -8px;
              top: 6px;
              bottom: 6px;
              width: 2px;
              background: var(--color-accent);
              border-radius: 2px;
            "
          />
          <BIcon :name="item.icon" :size="14" />
          <span class="flex-1">{{ item.label }}</span>
          <span
            v-if="item.badge"
            class="font-semibold"
            style="
              font-size: 10px;
              background: var(--color-border);
              color: var(--color-text-muted);
              padding: 1px 6px;
              border-radius: 9999px;
            "
          >
            {{ item.badge }}
          </span>
          <span v-if="item.kbd" class="kbd">{{ item.kbd }}</span>
        </router-link>
      </div>
    </nav>

    <!-- Footer -->
    <div
      class="flex items-center"
      style="padding: 10px 12px; border-top: 1px solid var(--color-border); gap: 10px"
    >
      <div
        class="flex items-center justify-center font-semibold"
        style="
          width: 26px;
          height: 26px;
          border-radius: 9999px;
          background: var(--color-border);
          color: var(--color-text);
          font-size: 11px;
        "
      >
        {{ initials }}
      </div>
      <div class="flex-1 min-w-0 leading-tight">
        <div
          class="truncate"
          style="font-size: 12px; font-weight: 500; color: var(--color-text)"
        >
          {{ displayName }}
        </div>
        <div
          v-if="role"
          class="truncate"
          style="font-size: 10px; color: var(--color-text-tertiary); text-transform: capitalize"
        >
          {{ role }}
        </div>
      </div>
      <button
        @click="toggle"
        :title="theme === 'dark' ? 'Hellen Modus' : 'Dunklen Modus'"
        class="nav-icon-btn"
        aria-label="Theme wechseln"
      >
        <BIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="14" />
      </button>
      <button @click="logout" title="Abmelden" class="nav-icon-btn" aria-label="Abmelden">
        <BIcon name="logout" :size="14" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.nav-item-idle {
  color: var(--color-text-secondary);
  background: transparent;
}
.nav-item-idle:hover {
  color: var(--color-text);
  background: var(--color-border-subtle);
}
.nav-item-active {
  color: var(--color-text);
  background: var(--color-border);
}
.nav-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
}
.nav-icon-btn:hover {
  color: var(--color-text);
  background: var(--color-border-subtle);
}
</style>

<!-- Nicht-scoped styles: Responsiver Overlay-Drawer + Backdrop.
     Unscoped, damit Media-Queries + position:fixed zuverlaessig greifen. -->
<style>
.sidebar-root {
  position: relative;
  z-index: 2;
}

/* Backdrop standardmaessig ausgeblendet (Desktop). */
.sidebar-backdrop {
  display: none;
}

@media (max-width: 1023.98px) {
  .sidebar-root {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    height: 100vh;
    z-index: 50;
    transition: transform 180ms ease-out;
    box-shadow: 2px 0 16px rgba(0, 0, 0, 0.18);
  }
  .sidebar-root.sidebar-closed {
    transform: translateX(-100%);
  }
  .sidebar-root.sidebar-open {
    transform: translateX(0);
  }
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 40;
  }
}
</style>
