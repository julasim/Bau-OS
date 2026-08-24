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
import { useBranding } from "../../composables/useBranding";
import { useCurrentUser } from "../../composables/useCurrentUser";
import BIcon from "../BIcon.vue";
import { useBenachrichtigungen } from "../../composables/useBenachrichtigungen";
import { useEvents } from "../../composables/useEvents";

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

// ── Die Glocke ────────────────────────────────────────────────────────────
//
// `NavItem.badge` war seit dem Bau der Leiste deklariert und wurde im Template
// ausgegeben — nur setzte ihn kein einziger Eintrag. Der Platz war da, die
// Zahl fehlte.
const { ungelesen, ladeAnzahl } = useBenachrichtigungen();

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "grid" },
  { to: "/neuigkeiten", label: "Neuigkeiten", icon: "bell" },
  { to: "/tasks", label: "Aufgaben", icon: "check" },
  { to: "/calendar", label: "Kalender", icon: "calendar" },
  { to: "/projects", label: "Projekte", icon: "folder" },
  { to: "/portfolio", label: "Portfolio", icon: "kanban" },
  { to: "/notes", label: "Notizen", icon: "pencil" },
  { to: "/files", label: "Dateien", icon: "file" },
  { to: "/team", label: "Team", icon: "users" },
  { to: "/firmen", label: "Firmen", icon: "layers" },
  { to: "/aktivitaet", label: "Aktivität", icon: "clock" },
  { to: "/papierkorb", label: "Papierkorb", icon: "trash" },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/admin/users", label: "Nutzer", icon: "user", adminOnly: true },
  { to: "/admin/audit", label: "Audit-Log", icon: "lock", adminOnly: true },
  { to: "/admin/sicherung", label: "Sicherung", icon: "archive", adminOnly: true },
];

const visibleNav = computed(() =>
  NAV_ITEMS.map((it) => (it.to === "/neuigkeiten" ? { ...it, badge: ungelesen.value } : it)),
);

void ladeAnzahl();
// Der Live-Kanal trägt keine Nutzdaten — er sagt nur, DASS sich etwas geändert
// hat. Für den Zähler reicht das: er wird dann neu geholt.
useEvents(["task", "termin", "meeting"], () => void ladeAnzahl());
const visibleAdmin = computed(() => (isAdmin.value ? ADMIN_ITEMS : []));

// ── Warum hier KEINE Projekt-Navigation mehr steht ────────────────────
//
// Bis zum Fokus-Modus wechselte diese Leiste in der Projektakte ihren Inhalt:
// statt des Arbeitsbereichs zeigte sie die Reiter des Projekts. Wer dort
// arbeitete, kam ohne Umweg nicht mehr zu den Aufgaben oder zum Kalender.
//
// Jetzt traegt die ContextSidebar (238px) die Reiter, und diese Leiste bleibt,
// was sie ist: der Weg durch das Programm. Die Reiter selbst stehen in
// `views/projekt-tabs.ts`.

// ── Branding-Logo ────────────────────────────────────────────────────
// Geteilte Quelle statt eigener Abfrage: die Topbar braucht denselben Wert,
// und zwei Bausteine, die dasselbe getrennt laden, ergeben zwei identische
// Aufrufe je Seitenaufbau.
const { branding, ensureBranding } = useBranding();

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

onMounted(() => void ensureBranding());
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
        <span class="pt-brand-word">PATIO</span>
      </template>
    </a>

    <!-- ══ Navigation durch das Programm ══ -->
    <div class="pt-nav-section">
      <span class="pt-nav-label pt-nav-text">Arbeitsbereich</span>
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
        <span class="pt-nav-text">{{ it.label }}</span>
        <span v-if="it.badge" class="badge pt-nav-text">{{ it.badge }}</span>
      </button>
    </div>

    <div v-if="visibleAdmin.length > 0" class="pt-nav-section">
      <span class="pt-nav-label pt-nav-text">SYSTEM</span>
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
        <span class="pt-nav-text">{{ it.label }}</span>
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
      <span class="pt-nav-text">Einstellungen</span>
    </button>

    <!-- User avatar / logout -->
    <button class="pt-nav-item pt-nav-avatar" :title="initials" aria-label="Abmelden" @click="logout">
      <span class="pt-avatar-circle">{{ initials }}</span>
    </button>
  </nav>
</template>
