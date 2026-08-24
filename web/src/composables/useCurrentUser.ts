// ============================================================
// PATIO — Aktueller User (global singleton)
// Einmalig /api/auth/me fragen, Ergebnis reaktiv teilen.
// Fallbacks: displayName -> username -> "Benutzer".
// Initialen: erste Buchstaben der ersten beiden Worte des Namens.
// ============================================================

import { ref, computed } from "vue";
import { api } from "../api";

interface Me {
  id: string | null;
  username: string;
  role: string;
  displayName: string | null;
  isProtected?: boolean;
  /** Darf Beträge sehen (Migration 043). Der Server liefert für Admins
   *  bereits `true` — die Oberfläche muss die Rolle hier nicht nachbauen. */
  canSeeMoney?: boolean;
}

const user = ref<Me | null>(null);
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  if (user.value) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      user.value = await api.get<Me>("/auth/me");
    } catch {
      // Bei Fehler bleibt user null — UI zeigt Fallbacks.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function useCurrentUser() {
  // Lazy laden beim ersten Zugriff (ok, weil ref bereits null ist und
  // die UI mit Fallback rendert, waehrend der Request laeuft).
  if (!user.value && !inflight) {
    void load();
  }

  const displayName = computed(() => user.value?.displayName?.trim() || user.value?.username || "Benutzer");
  const initials = computed(() => computeInitials(displayName.value));
  const role = computed(() => user.value?.role ?? "");
  const username = computed(() => user.value?.username ?? "");
  const userId = computed(() => user.value?.id ?? null);
  const isAdmin = computed(() => user.value?.role === "admin");
  // ── Warum es diesen Schalter braucht ──────────────────────────────────
  //
  // `/auth/me` kommt asynchron. Bis die Antwort da ist, sind `isAdmin` und
  // `darfGeld` beide `false` — und das ist von „darf wirklich nicht" nicht
  // zu unterscheiden. Wer daraus schon eine Entscheidung ableitet, wirft
  // einen Verwalter aus einem Bereich, den er sehr wohl oeffnen darf.
  // Genau das ist beim Bereichs-Waechter der Einstellungen passiert.
  const geladen = computed(() => user.value !== null);
  const isProtected = computed(() => user.value?.isProtected ?? false);
  // Ohne dieses Recht entfernt der Server die Geldfelder aus den Antworten.
  // Die Oberfläche blendet die zugehörigen Spalten aus, statt leere Zellen zu
  // zeigen — sonst sähe es nach einem Fehler aus statt nach einer Regel.
  const darfGeld = computed(() => user.value?.canSeeMoney ?? false);

  return {
    user,
    displayName,
    initials,
    role,
    username,
    userId,
    isAdmin,
    geladen,
    isProtected,
    darfGeld,
    reload: () => {
      user.value = null;
      return load();
    },
  };
}
