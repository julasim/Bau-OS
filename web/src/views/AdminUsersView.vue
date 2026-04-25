<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useCurrentUser } from "../composables/useCurrentUser";

const router = useRouter();

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  isProtected: boolean;
  hasTelegram: boolean;
  createdAt: string;
  updatedAt: string;
}

const { userId: currentUserId, isAdmin, user: currentUser } = useCurrentUser();

// Client-seitiger Schutz: wenn das Profil schon geladen ist und der User
// kein Admin ist, sofort raus. Wenn das Profil noch laedt, watcht der Watcher
// auf die Aenderung. Backend gibt sowieso 403 — das ist nur kosmetisch und
// vermeidet das kurze Aufflackern der UI.
function ensureAdmin() {
  if (currentUser.value && !isAdmin.value) router.replace("/");
}
watch(currentUser, ensureAdmin, { immediate: true });
const users = ref<AdminUser[]>([]);
const loading = ref(false);
const errorBanner = ref<string | null>(null);

// ── Anlegen-Dialog ──────────────────────────────────────
const showCreateDialog = ref(false);
const createSaving = ref(false);
const createError = ref<string | null>(null);
const createForm = ref({
  username: "",
  password: "",
  passwordConfirm: "",
  role: "user" as "admin" | "user",
  displayName: "",
});

function openCreate() {
  createForm.value = {
    username: "",
    password: "",
    passwordConfirm: "",
    role: "user",
    displayName: "",
  };
  createError.value = null;
  showCreateDialog.value = true;
}

const createCanSubmit = computed(
  () =>
    !createSaving.value &&
    createForm.value.username.trim().length >= 3 &&
    createForm.value.password.length >= 8 &&
    createForm.value.password === createForm.value.passwordConfirm,
);

async function submitCreate() {
  if (!createCanSubmit.value) return;
  createSaving.value = true;
  createError.value = null;
  try {
    await api.post<AdminUser>("/admin/users", {
      username: createForm.value.username.trim(),
      password: createForm.value.password,
      role: createForm.value.role,
      displayName: createForm.value.displayName.trim() || undefined,
    });
    showCreateDialog.value = false;
    await loadUsers();
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    createSaving.value = false;
  }
}

// ── Passwort zuruecksetzen ──────────────────────────────
const showPasswordDialog = ref(false);
const passwordTarget = ref<AdminUser | null>(null);
const passwordValue = ref("");
const passwordSaving = ref(false);
const passwordError = ref<string | null>(null);

function openPasswordReset(user: AdminUser) {
  passwordTarget.value = user;
  passwordValue.value = "";
  passwordError.value = null;
  showPasswordDialog.value = true;
}

async function submitPasswordReset() {
  if (!passwordTarget.value || passwordValue.value.length < 8) return;
  passwordSaving.value = true;
  passwordError.value = null;
  try {
    await api.patch(`/admin/users/${encodeURIComponent(passwordTarget.value.id)}/password`, {
      newPassword: passwordValue.value,
    });
    showPasswordDialog.value = false;
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : "Update fehlgeschlagen";
  } finally {
    passwordSaving.value = false;
  }
}

// ── Telegram-Pair-Token (Phase 5) ───────────────────────
const showPairDialog = ref(false);
const pairTarget = ref<AdminUser | null>(null);
const pairToken = ref<string | null>(null);
const pairExpiresAt = ref<string | null>(null);
const pairSaving = ref(false);
const pairError = ref<string | null>(null);
const pairCountdown = ref<string>("");
let pairCountdownTimer: ReturnType<typeof setInterval> | null = null;

async function openPairDialog(user: AdminUser) {
  pairTarget.value = user;
  pairToken.value = null;
  pairExpiresAt.value = null;
  pairError.value = null;
  showPairDialog.value = true;
  pairSaving.value = true;
  try {
    const res = await api.post<{ token: string; expiresAt: string }>(
      `/admin/users/${encodeURIComponent(user.id)}/pair-token`,
      {},
    );
    pairToken.value = res.token;
    pairExpiresAt.value = res.expiresAt;
    startPairCountdown();
  } catch (e) {
    pairError.value = e instanceof Error ? e.message : "Token konnte nicht generiert werden";
  } finally {
    pairSaving.value = false;
  }
}

function closePairDialog() {
  showPairDialog.value = false;
  if (pairCountdownTimer) {
    clearInterval(pairCountdownTimer);
    pairCountdownTimer = null;
  }
}

function startPairCountdown() {
  if (pairCountdownTimer) clearInterval(pairCountdownTimer);
  const tick = () => {
    if (!pairExpiresAt.value) return;
    const diff = new Date(pairExpiresAt.value).getTime() - Date.now();
    if (diff <= 0) {
      pairCountdown.value = "abgelaufen";
      if (pairCountdownTimer) {
        clearInterval(pairCountdownTimer);
        pairCountdownTimer = null;
      }
      return;
    }
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    pairCountdown.value = `${m}:${String(s).padStart(2, "0")}`;
  };
  tick();
  pairCountdownTimer = setInterval(tick, 1000);
}

async function copyToken() {
  if (!pairToken.value) return;
  try {
    await navigator.clipboard.writeText(pairToken.value);
  } catch {
    /* clipboard API kann fehlen — User markiert manuell */
  }
}

// ── Inline-Aktionen ─────────────────────────────────────
async function toggleRole(user: AdminUser) {
  if (user.isProtected) return;
  const newRole = user.role === "admin" ? "user" : "admin";
  const action = newRole === "admin" ? "zum Admin befoerdern" : "auf Nutzer herabstufen";
  if (!confirm(`"${user.username}" ${action}?`)) return;
  try {
    await api.patch(`/admin/users/${encodeURIComponent(user.id)}`, { role: newRole });
    await loadUsers();
  } catch (e) {
    errorBanner.value = e instanceof Error ? e.message : "Update fehlgeschlagen";
    setTimeout(() => (errorBanner.value = null), 4000);
  }
}

async function deleteUser(user: AdminUser) {
  if (user.isProtected) return;
  if (currentUserId.value === user.id) {
    errorBanner.value = "Du kannst dich nicht selbst loeschen";
    setTimeout(() => (errorBanner.value = null), 4000);
    return;
  }
  if (!confirm(`"${user.username}" wirklich loeschen?`)) return;
  try {
    await api.delete(`/admin/users/${encodeURIComponent(user.id)}`);
    await loadUsers();
  } catch (e) {
    errorBanner.value = e instanceof Error ? e.message : "Loeschen fehlgeschlagen";
    setTimeout(() => (errorBanner.value = null), 4000);
  }
}

// ── Initial laden ───────────────────────────────────────
async function loadUsers() {
  loading.value = true;
  try {
    users.value = await api.get<AdminUser[]>("/admin/users");
  } catch (e) {
    errorBanner.value = e instanceof Error ? e.message : "Laden fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}

onMounted(loadUsers);

// Timer-Cleanup beim Unmount, falls der Pair-Modal offen war als der User
// die Seite verlassen hat.
onUnmounted(() => {
  if (pairCountdownTimer) {
    clearInterval(pairCountdownTimer);
    pairCountdownTimer = null;
  }
});

// ── Helpers ─────────────────────────────────────────────
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}
</script>

<template>
  <div style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">System</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Nutzer</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ users.length }} Konten
        </p>
      </div>
      <button @click="openCreate" class="bauos-btn solid">
        <BIcon name="plus" :size="14" />
        <span style="margin-left: 4px">Neuer Nutzer</span>
      </button>
    </div>

    <p
      v-if="errorBanner"
      style="
        margin-bottom: 12px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--color-danger-text);
        background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
        border-radius: 6px;
      "
    >
      {{ errorBanner }}
    </p>

    <!-- Liste -->
    <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
      <div
        class="flex items-center"
        style="
          gap: 12px;
          padding: 10px 16px;
          background: var(--color-bg-subtle);
          border-bottom: 1px solid var(--color-border);
        "
      >
        <span class="eyebrow flex-1">Name</span>
        <span class="eyebrow" style="width: 90px">Rolle</span>
        <span class="eyebrow" style="width: 70px">Telegram</span>
        <span class="eyebrow" style="width: 100px">Angelegt</span>
        <span class="eyebrow" style="width: 30px"></span>
      </div>
      <div
        v-for="u in users"
        :key="u.id"
        class="user-row"
        :class="{ 'user-row-protected': u.isProtected, 'user-row-self': u.id === currentUserId }"
      >
        <div class="flex items-center" style="gap: 10px; flex: 1; min-width: 0">
          <div class="user-avatar">{{ initials(u.displayName ?? u.username) }}</div>
          <div style="min-width: 0">
            <div style="font-size: 13px; color: var(--color-text); display: flex; align-items: center; gap: 6px">
              <span>{{ u.displayName ?? u.username }}</span>
              <BIcon
                v-if="u.isProtected"
                name="lock"
                :size="11"
                style="color: var(--color-text-muted)"
                :title="'Geschützter Erst-Admin — kann nicht herabgestuft oder gelöscht werden'"
              />
              <span
                v-if="u.id === currentUserId"
                style="
                  font-size: 9px;
                  padding: 1px 6px;
                  border-radius: 999px;
                  background: var(--color-bg-subtle);
                  color: var(--color-text-muted);
                  text-transform: uppercase;
                  letter-spacing: 0.04em;
                "
                >Du</span
              >
            </div>
            <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 1px">
              <span v-if="u.displayName">{{ u.username }}</span>
            </div>
          </div>
        </div>
        <div style="width: 90px">
          <button
            class="role-btn"
            :class="`role-btn-${u.role}`"
            :disabled="u.isProtected || u.id === currentUserId"
            @click="toggleRole(u)"
            :title="u.isProtected ? 'Geschützter Admin' : 'Rolle wechseln'"
          >
            {{ u.role === "admin" ? "Admin" : "Nutzer" }}
          </button>
        </div>
        <div style="width: 70px; font-size: 11px; color: var(--color-text-muted)">
          {{ u.hasTelegram ? "✓" : "—" }}
        </div>
        <div class="font-mono" style="width: 100px; font-size: 11px; color: var(--color-text-tertiary)">
          {{ formatDate(u.createdAt) }}
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 4px">
          <button class="row-action" @click="openPairDialog(u)" :title="'Telegram pairen'">
            <BIcon name="message" :size="12" />
          </button>
          <button class="row-action" @click="openPasswordReset(u)" :title="'Passwort zurücksetzen'">
            <BIcon name="lock" :size="12" />
          </button>
          <button
            class="row-action row-action-danger"
            @click="deleteUser(u)"
            :disabled="u.isProtected || u.id === currentUserId"
            :title="
              u.isProtected
                ? 'Geschützter Admin'
                : u.id === currentUserId
                  ? 'Du selbst'
                  : 'Löschen'
            "
          >
            <BIcon name="x" :size="12" />
          </button>
        </div>
      </div>
      <p
        v-if="!loading && users.length === 0"
        style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 32px"
      >
        Noch keine Nutzer.
      </p>
      <p
        v-else-if="loading"
        style="font-size: 13px; color: var(--color-text-muted); text-align: center; padding: 24px"
      >
        Lade…
      </p>
    </div>

    <!-- Anlegen-Dialog -->
    <div v-if="showCreateDialog" class="modal-overlay" @click.self="showCreateDialog = false">
      <div class="modal-card">
        <div class="flex items-center justify-between" style="margin-bottom: 16px">
          <div>
            <div class="eyebrow" style="margin-bottom: 4px">Neu</div>
            <h2 style="font-size: 18px; font-weight: 600; margin: 0">Nutzer anlegen</h2>
          </div>
          <button class="modal-close" @click="showCreateDialog = false" :disabled="createSaving">
            <BIcon name="x" :size="14" />
          </button>
        </div>
        <div class="form-grid">
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Benutzername *</span>
            <input
              v-model="createForm.username"
              type="text"
              minlength="3"
              autocomplete="username"
              class="form-input-lg"
              autofocus
            />
          </label>
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Anzeige-Name</span>
            <input
              v-model="createForm.displayName"
              type="text"
              placeholder="Optional, z.B. „Herbert Müller"
              class="form-input-lg"
            />
          </label>
          <label class="form-field">
            <span class="eyebrow">Passwort *</span>
            <input
              v-model="createForm.password"
              type="password"
              minlength="8"
              autocomplete="new-password"
              class="form-input-lg"
            />
          </label>
          <label class="form-field">
            <span class="eyebrow">Bestätigung *</span>
            <input
              v-model="createForm.passwordConfirm"
              type="password"
              autocomplete="new-password"
              class="form-input-lg"
            />
          </label>
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Rolle</span>
            <select v-model="createForm.role" class="form-input-lg">
              <option value="user">Nutzer (sieht nur zugewiesene Projekte)</option>
              <option value="admin">Admin (sieht alles, verwaltet Nutzer)</option>
            </select>
          </label>
        </div>
        <p
          v-if="createError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ createError }}
        </p>
        <div class="flex items-center justify-end" style="gap: 8px; margin-top: 20px">
          <button class="bauos-btn ghost" @click="showCreateDialog = false" :disabled="createSaving">
            Abbrechen
          </button>
          <button class="bauos-btn solid" :disabled="!createCanSubmit" @click="submitCreate">
            {{ createSaving ? "Lege an…" : "Anlegen" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Passwort-Reset-Dialog -->
    <div v-if="showPasswordDialog && passwordTarget" class="modal-overlay" @click.self="showPasswordDialog = false">
      <div class="modal-card" style="max-width: 440px">
        <div class="eyebrow" style="margin-bottom: 4px">Passwort</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px 0">
          Passwort für „{{ passwordTarget.username }}" zurücksetzen
        </h2>
        <p style="font-size: 12px; color: var(--color-text-muted); margin: 0 0 12px 0">
          Der Nutzer kann sich nach dem Reset mit dem neuen Passwort anmelden. Das alte Passwort
          wird sofort ungültig.
        </p>
        <input
          v-model="passwordValue"
          type="password"
          minlength="8"
          autocomplete="new-password"
          placeholder="Neues Passwort (mind. 8 Zeichen)"
          class="form-input-lg"
          style="width: 100%"
          @keyup.enter="submitPasswordReset"
          autofocus
        />
        <p
          v-if="passwordError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ passwordError }}
        </p>
        <div class="flex items-center justify-end" style="gap: 8px; margin-top: 16px">
          <button class="bauos-btn ghost" @click="showPasswordDialog = false" :disabled="passwordSaving">
            Abbrechen
          </button>
          <button
            class="bauos-btn solid"
            :disabled="passwordValue.length < 8 || passwordSaving"
            @click="submitPasswordReset"
          >
            {{ passwordSaving ? "…" : "Zurücksetzen" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Telegram-Pair-Dialog (Phase 5) -->
    <div v-if="showPairDialog && pairTarget" class="modal-overlay" @click.self="closePairDialog">
      <div class="modal-card" style="max-width: 480px">
        <div class="eyebrow" style="margin-bottom: 4px">Telegram</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 4px 0">
          „{{ pairTarget.username }}" mit Telegram verknüpfen
        </h2>
        <p style="font-size: 12px; color: var(--color-text-muted); margin: 0 0 18px 0">
          Der Code ist 10 Minuten gültig. Der Nutzer schickt
          <code style="font-family: var(--font-mono, monospace); background: var(--color-bg-subtle); padding: 1px 4px; border-radius: 3px">/pair {{ pairToken ?? "&lt;code&gt;" }}</code>
          an den Bot.
        </p>

        <div v-if="pairSaving" style="text-align: center; padding: 24px; color: var(--color-text-muted)">
          Lade Code…
        </div>
        <div
          v-else-if="pairError"
          style="
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ pairError }}
        </div>
        <div v-else-if="pairToken" class="pair-token-box">
          <div class="pair-token-label">Pair-Code</div>
          <div class="pair-token-value">{{ pairToken }}</div>
          <div class="pair-token-meta">
            <span>Gültig noch:</span>
            <span class="font-mono" :class="{ 'pair-token-expired': pairCountdown === 'abgelaufen' }">
              {{ pairCountdown }}
            </span>
            <button class="bauos-btn ghost sm" @click="copyToken" :title="'In Zwischenablage'">
              Kopieren
            </button>
          </div>
        </div>

        <div class="flex items-center justify-end" style="gap: 8px; margin-top: 20px">
          <button class="bauos-btn solid" @click="closePairDialog">Schließen</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
  transition: background 180ms ease;
}
.user-row:hover {
  background: var(--color-bg-subtle);
}
.user-row-protected {
  background: color-mix(in srgb, var(--color-primary, #4f46e5) 4%, transparent);
}
.user-row-self {
  border-left: 2px solid var(--color-primary);
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.role-btn {
  font-size: 10px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid;
  cursor: pointer;
  background: transparent;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition: all 180ms ease;
}
.role-btn-admin {
  color: var(--color-warning-text, #b45309);
  border-color: var(--color-warning-text, #b45309);
}
.role-btn-user {
  color: var(--color-text-muted);
  border-color: var(--color-border);
}
.role-btn:hover:not(:disabled) {
  filter: brightness(0.9);
}
.role-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.row-action {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 180ms ease;
}
.row-action:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-bg-subtle);
}
.row-action-danger:hover:not(:disabled) {
  color: var(--color-danger-text);
}
.row-action:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, #000 55%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 80px 20px 20px;
  z-index: 1000;
  overflow-y: auto;
}
.modal-card {
  width: 100%;
  max-width: 560px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.modal-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.form-field-span-2 {
  grid-column: span 2;
}
.form-input-lg {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 180ms ease;
}
.form-input-lg:focus {
  border-color: var(--color-primary);
}

.bauos-btn.sm {
  padding: 4px 10px;
  font-size: 11px;
}

/* ── Pair-Token-Box ─────────────────────────────────────── */
.pair-token-box {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px 20px;
  background: var(--color-bg-subtle);
  text-align: center;
}
.pair-token-label {
  font-size: 10px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.pair-token-value {
  font-family: var(--font-mono, monospace);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--color-text);
  margin-bottom: 12px;
  user-select: all;
}
.pair-token-meta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--color-text-muted);
}
.pair-token-expired {
  color: var(--color-danger-text);
}
</style>
