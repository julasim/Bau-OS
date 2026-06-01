<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — Nav-Rail (56px)
// ============================================================
// Linke Spalte des 3-Spalten-Shells. Icon-only, max 8 Sektionen
// (siehe Design-Handoff). Brand-Mark oben (Logo oder "SIMA"-
// Wortmarke), Settings + Avatar unten.
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
    /* unauth oder Backend down — Fallback auf SIMA-Wortmarke */
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
  <nav class="nav-rail" aria-label="Hauptnavigation">
    <a class="brand-mark" :title="branding.companyName ?? 'SIMA'" @click.prevent="go('/')" href="/">
      <img v-if="branding.logoUrl" :src="branding.logoUrl" :alt="branding.companyName ?? 'Logo'" />
      <span v-else>SIMA</span>
    </a>

    <button
      v-for="it in visibleNav"
      :key="it.to"
      class="nav-btn"
      :data-active="isActive(it.to)"
      @click="go(it.to)"
      :title="it.label"
      :aria-label="it.label"
    >
      <BIcon :name="it.icon" :size="18" />
      <span v-if="it.badge" class="badge">{{ it.badge }}</span>
    </button>

    <div v-if="visibleAdmin.length > 0" style="height: 12px"></div>
    <button
      v-for="it in visibleAdmin"
      :key="it.to"
      class="nav-btn"
      :data-active="isActive(it.to)"
      @click="go(it.to)"
      :title="it.label"
    >
      <BIcon :name="it.icon" :size="18" />
    </button>

    <div class="spacer"></div>

    <button
      class="nav-btn"
      :data-active="isActive('/settings')"
      @click="go('/settings')"
      title="Einstellungen"
      aria-label="Einstellungen"
    >
      <BIcon name="settings" :size="18" />
    </button>

    <div class="me" :title="initials" @click="logout">
      {{ initials }}
    </div>
  </nav>
</template>
