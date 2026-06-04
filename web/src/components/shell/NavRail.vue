<script setup lang="ts">
// ============================================================
// PATIO — Sidebar (240px, always dark)
// ============================================================
// Linke Spalte des App-Shells. Icon + Label, zwei Sektionen
// (PROJEKTE / SYSTEM), Brand-Mark oben, Settings + Avatar unten.
// ============================================================

import { computed, onMounted, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { api, clearToken } from "../../api";
import { useCurrentUser } from "../../composables/useCurrentUser";
import BIcon from "../BIcon.vue";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
  adminOnly?: boolean;
}

const router = useRouter();
const route = useRoute();
const { initials, isAdmin } = useCurrentUser();

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "grid" },
  { to: "/tasks", label: "Aufgaben", icon: "check" },
  { to: "/calendar", label: "Kalender", icon: "calendar" },
  { to: "/projects", label: "Projekte", icon: "folder" },
  { to: "/notes", label: "Notizen", icon: "pencil" },
  { to: "/files", label: "Dateien", icon: "file" },
  { to: "/chat", label: "Chat & Agenten", icon: "message" },
  { to: "/team", label: "Team", icon: "users" },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/admin/users", label: "Nutzer", icon: "user", adminOnly: true },
  { to: "/admin/audit", label: "Audit-Log", icon: "lock", adminOnly: true },
];

const visibleNav = computed(() => NAV_ITEMS);
const visibleAdmin = computed(() => (isAdmin.value ? ADMIN_ITEMS : []));

// ── Branding-Logo (Phase 6g) ─────────────────────────────────────────
interface BrandingLite {
  companyName: string | null;
  logoUrl: string | null;
}
const branding = ref<BrandingLite>({ companyName: null, logoUrl: null });
async function loadBranding() {
  try {
    branding.value = await api.get<BrandingLite>("/branding");
  } catch {
    /* unauth oder Backend down — Fallback auf PATIO-Wortmarke */
  }
}

function isActive(to: string): boolean {
  if (to === "/") return route.path === "/";
  return route.path.startsWith(to);
}

function go(to: string) {
  router.push(to);
}

function logout() {
  clearToken();
  router.push("/login");
}

onMounted(() => void loadBranding());
</script>

<template>
  <nav class="pt-sidebar" aria-label="Hauptnavigation">
    <!-- Brand -->
    <a class="pt-sidebar-brand" :title="branding.companyName ?? 'PATIO'" @click.prevent="go('/')" href="/">
      <img v-if="branding.logoUrl" :src="branding.logoUrl" :alt="branding.companyName ?? 'Logo'" />
      <template v-else>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="24"
          height="24"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <rect x="8" y="8" width="8" height="8" rx="1" />
        </svg>
        <span>PATIO</span>
      </template>
    </a>

    <!-- Section: PROJEKTE -->
    <div class="pt-nav-section">
      <span class="pt-nav-label">PROJEKTE</span>
      <button
        v-for="it in visibleNav"
        :key="it.to"
        class="pt-nav-item"
        :class="{ 'is-active': isActive(it.to) }"
        @click="go(it.to)"
        :title="it.label"
        :aria-label="it.label"
      >
        <BIcon :name="it.icon" :size="16" />
        <span>{{ it.label }}</span>
        <span v-if="it.badge" class="badge">{{ it.badge }}</span>
      </button>
    </div>

    <!-- Section: SYSTEM (admin only) -->
    <div v-if="visibleAdmin.length > 0" class="pt-nav-section">
      <span class="pt-nav-label">SYSTEM</span>
      <button
        v-for="it in visibleAdmin"
        :key="it.to"
        class="pt-nav-item"
        :class="{ 'is-active': isActive(it.to) }"
        @click="go(it.to)"
        :title="it.label"
        :aria-label="it.label"
      >
        <BIcon :name="it.icon" :size="16" />
        <span>{{ it.label }}</span>
      </button>
    </div>

    <div class="spacer"></div>

    <!-- Settings -->
    <button
      class="pt-nav-item"
      :class="{ 'is-active': isActive('/settings') }"
      @click="go('/settings')"
      title="Einstellungen"
      aria-label="Einstellungen"
    >
      <BIcon name="settings" :size="16" />
      <span>Einstellungen</span>
    </button>

    <!-- User avatar / logout -->
    <button class="pt-nav-item pt-nav-avatar" :title="initials" aria-label="Abmelden" @click="logout">
      <span class="pt-avatar-circle">{{ initials }}</span>
    </button>
  </nav>
</template>
