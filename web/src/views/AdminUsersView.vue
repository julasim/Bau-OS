<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { copyToClipboard } from "../utils/clipboard";
import { useCurrentUser } from "../composables/useCurrentUser";
import { useConfirm } from "../composables/useConfirm";

const { confirm } = useConfirm();

const router = useRouter();

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  isProtected: boolean;
  hasTelegram: boolean;
  email: string | null;
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
  email: "",
  password: "",
  passwordConfirm: "",
  role: "user" as "admin" | "user",
  displayName: "",
});

function openCreate() {
  createForm.value = {
    username: "",
    email: "",
    password: "",
    passwordConfirm: "",
    role: "user",
    displayName: "",
  };
  createError.value = null;
  showCreateDialog.value = true;
}

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.value.email.trim()));

const createCanSubmit = computed(
  () =>
    !createSaving.value &&
    createForm.value.username.trim().length >= 3 &&
    emailValid.value &&
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
      email: createForm.value.email.trim().toLowerCase(),
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

// ── Bot-Token verwalten (Admin-Override) ───────────────────────
// Erlaubt dem Admin, fuer einen User direkt das Bot-Token einzutragen,
// ohne dass der User sich selbst einloggen muss. Ueblicher Onboarding-
// Flow: Admin legt User an → User-Account verlinkt mit Team-Mitglied
// → Admin generiert Bot-Token bei @BotFather → traegt ihn hier ein →
// Backend startet sofort den per-User-Bot → Admin generiert Pair-Code
// → schickt /pair an User.
const showBotDialog = ref(false);
const botTarget = ref<AdminUser | null>(null);
interface BotStatus {
  hasToken: boolean;
  enabled: boolean;
  chatId: string | null;
  botUsername: string | null;
  botRunning: boolean;
}
const botStatus = ref<BotStatus | null>(null);
const botTokenInput = ref("");
const botDialogSaving = ref(false);
const botDialogError = ref<string | null>(null);
const botDialogMessage = ref<string | null>(null);

const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const botTokenValid = computed(() => BOT_TOKEN_RE.test(botTokenInput.value.trim()));

async function openBotTokenDialog(user: AdminUser) {
  botTarget.value = user;
  botTokenInput.value = "";
  botDialogError.value = null;
  botDialogMessage.value = null;
  botStatus.value = null;
  showBotDialog.value = true;
  try {
    botStatus.value = await api.get<BotStatus>(`/admin/users/${encodeURIComponent(user.id)}/telegram-bot`);
  } catch (e) {
    botDialogError.value = e instanceof Error ? e.message : "Status nicht abrufbar";
  }
}

function closeBotTokenDialog() {
  showBotDialog.value = false;
  botTokenInput.value = "";
  botDialogError.value = null;
  botDialogMessage.value = null;
}

async function saveBotToken() {
  if (!botTarget.value || !botTokenValid.value || botDialogSaving.value) return;
  const token = botTokenInput.value.trim();
  botDialogSaving.value = true;
  botDialogError.value = null;
  botDialogMessage.value = null;
  try {
    const res = await api.put<{ ok: boolean; botUsername: string | null; botRunning: boolean }>(
      `/admin/users/${encodeURIComponent(botTarget.value.id)}/telegram-bot`,
      { token },
    );
    botTokenInput.value = "";
    if (res.botRunning && res.botUsername) {
      botDialogMessage.value = `Bot @${res.botUsername} läuft. Jetzt Pair-Code generieren und dem User schicken.`;
    } else {
      botDialogMessage.value = "Token gespeichert, aber Bot startet nicht. Token bei @BotFather noch gültig?";
    }
    // Status frisch laden
    botStatus.value = await api.get<BotStatus>(`/admin/users/${encodeURIComponent(botTarget.value.id)}/telegram-bot`);
  } catch (e) {
    botDialogError.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    botDialogSaving.value = false;
  }
}

async function removeBotToken() {
  if (!botTarget.value || !(await confirm({ message: "Bot-Token wirklich entfernen?", confirmDanger: true }))) return;
  botDialogSaving.value = true;
  botDialogError.value = null;
  try {
    await api.put(`/admin/users/${encodeURIComponent(botTarget.value.id)}/telegram-bot`, {
      token: null,
    });
    botDialogMessage.value = "Bot entfernt.";
    botStatus.value = await api.get<BotStatus>(`/admin/users/${encodeURIComponent(botTarget.value.id)}/telegram-bot`);
  } catch (e) {
    botDialogError.value = e instanceof Error ? e.message : "Entfernen fehlgeschlagen";
  } finally {
    botDialogSaving.value = false;
  }
}

// ── Telegram-Pair-Token (Phase 5) ───────────────────────
const showPairDialog = ref(false);
const pairTarget = ref<AdminUser | null>(null);
const pairToken = ref<string | null>(null);
const pairBotUsername = ref<string | null>(null);
const pairExpiresAt = ref<string | null>(null);
const pairSaving = ref(false);
const pairError = ref<string | null>(null);
const pairCountdown = ref<string>("");
let pairCountdownTimer: ReturnType<typeof setInterval> | null = null;

// Voller Befehl, den der User in Telegram an den Bot schickt — als Block
// fuers Copy-to-Clipboard. Inkl. /pair-Praefix damit nichts vergessen wird.
const pairCommand = computed(() => (pairToken.value ? `/pair ${pairToken.value}` : ""));
const pairBotLink = computed(() => (pairBotUsername.value ? `https://t.me/${pairBotUsername.value}` : null));

async function openPairDialog(user: AdminUser) {
  pairTarget.value = user;
  pairToken.value = null;
  pairBotUsername.value = null;
  pairExpiresAt.value = null;
  pairError.value = null;
  showPairDialog.value = true;
  pairSaving.value = true;
  try {
    const res = await api.post<{ token: string; expiresAt: string; botUsername: string | null }>(
      `/admin/users/${encodeURIComponent(user.id)}/pair-token`,
      {},
    );
    pairToken.value = res.token;
    pairBotUsername.value = res.botUsername ?? null;
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

// Gemeinsames Feedback-Message-State fuer beide Copy-Aktionen.
// success = gruener Hinweis, error = roter Hinweis. 2.5s sichtbar.
const copyMessage = ref<{ text: string; type: "success" | "error" } | null>(null);
function showCopyFeedback(text: string, type: "success" | "error") {
  copyMessage.value = { text, type };
  setTimeout(() => {
    if (copyMessage.value?.text === text) copyMessage.value = null;
  }, 2500);
}

async function copyToken() {
  if (!pairToken.value) return;
  const ok = await copyToClipboard(pairToken.value);
  if (ok) {
    showCopyFeedback(`Code "${pairToken.value}" kopiert`, "success");
  } else {
    showCopyFeedback("Kopieren fehlgeschlagen — bitte manuell markieren", "error");
  }
}

// Kopiert den vollstaendigen "/pair CODE"-Befehl (haeufiger Wunsch: einfach
// in Telegram pasten ohne nochmal zu tippen).
async function copyPairCommand() {
  if (!pairCommand.value) return;
  const ok = await copyToClipboard(pairCommand.value);
  if (ok) {
    showCopyFeedback("Befehl kopiert", "success");
  } else {
    showCopyFeedback("Kopieren fehlgeschlagen — bitte manuell markieren", "error");
  }
}

// ── Inline-Aktionen ─────────────────────────────────────
async function toggleRole(user: AdminUser) {
  if (user.isProtected) return;
  const newRole = user.role === "admin" ? "user" : "admin";
  const action = newRole === "admin" ? "zum Admin befoerdern" : "auf Nutzer herabstufen";
  if (!(await confirm(`"${user.username}" ${action}?`))) return;
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
  if (!(await confirm({ message: `"${user.username}" wirklich loeschen?`, confirmDanger: true }))) return;
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
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">System</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Nutzer</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">{{ users.length }} Konten</p>
      </div>
      <button @click="openCreate" class="patio-btn solid">
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
    <div class="users-list-wrap" style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
      <div class="users-list-inner">
        <!-- Header — auf Mobile via CSS hidden -->
        <div class="users-list-header flex items-center">
          <span class="eyebrow flex-1">Name</span>
          <span class="eyebrow" style="width: 90px">Rolle</span>
          <span class="eyebrow" style="width: 70px">Telegram</span>
          <span class="eyebrow" style="width: 100px">Angelegt</span>
          <span class="eyebrow" style="width: 148px; text-align: right">Aktionen</span>
        </div>
        <div
          v-for="u in users"
          :key="u.id"
          class="user-row"
          :class="{ 'user-row-protected': u.isProtected, 'user-row-self': u.id === currentUserId }"
        >
          <div class="user-name-block flex items-center" style="gap: 10px; flex: 1; min-width: 0">
            <div class="user-avatar">{{ initials(u.displayName ?? u.username) }}</div>
            <div style="min-width: 0; flex: 1">
              <div
                style="
                  font-size: 13px;
                  color: var(--color-text);
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  flex-wrap: wrap;
                "
              >
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
              <!-- Mobile-Meta-Zeile: Rolle + Telegram-Status + Datum als Chips,
                 nur unter 768px sichtbar (CSS unten). -->
              <div class="user-meta-mobile">
                <button
                  class="role-btn"
                  :class="`role-btn-${u.role}`"
                  :disabled="u.isProtected || u.id === currentUserId"
                  @click="toggleRole(u)"
                >
                  {{ u.role === "admin" ? "Admin" : "Nutzer" }}
                </button>
                <span class="user-meta-text">
                  {{ u.hasTelegram ? "Telegram verknüpft" : "kein Telegram" }}
                </span>
                <span class="user-meta-text font-mono" style="display: inline-flex; align-items: center; gap: 4px">
                  <BIcon name="calendar" :size="10" />{{ formatDate(u.createdAt) }}
                </span>
              </div>
            </div>
          </div>
          <div class="user-col-role" style="width: 90px">
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
          <div
            class="user-col-telegram"
            style="width: 70px; font-size: 11px; color: var(--color-text-muted); display: flex; align-items: center"
          >
            <BIcon v-if="u.hasTelegram" name="check" :size="13" />
            <span v-else>—</span>
          </div>
          <div class="user-col-date font-mono" style="width: 100px; font-size: 11px; color: var(--color-text-tertiary)">
            {{ formatDate(u.createdAt) }}
          </div>
          <div class="user-actions" style="display: flex; justify-content: flex-end; gap: 4px">
            <button class="row-action" @click="openBotTokenDialog(u)" :title="'Bot-Token verwalten'">
              <BIcon name="cpu" :size="12" />
            </button>
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
              :title="u.isProtected ? 'Geschützter Admin' : u.id === currentUserId ? 'Du selbst' : 'Löschen'"
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
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Email * (für 2FA-Login)</span>
            <input
              v-model="createForm.email"
              type="email"
              autocomplete="email"
              placeholder="name@firma.at"
              class="form-input-lg"
              required
            />
            <span
              v-if="createForm.email.length > 0 && !emailValid"
              style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px"
            >
              Bitte eine gültige Email-Adresse — wird für 2FA-Login per Code verwendet.
            </span>
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
          <button class="patio-btn ghost" @click="showCreateDialog = false" :disabled="createSaving">Abbrechen</button>
          <button class="patio-btn solid" :disabled="!createCanSubmit" @click="submitCreate">
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
          Der Nutzer kann sich nach dem Reset mit dem neuen Passwort anmelden. Das alte Passwort wird sofort ungültig.
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
          <button class="patio-btn ghost" @click="showPasswordDialog = false" :disabled="passwordSaving">
            Abbrechen
          </button>
          <button
            class="patio-btn solid"
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
      <div class="modal-card" style="max-width: 520px">
        <div class="eyebrow" style="margin-bottom: 4px">Telegram</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 14px 0">
          „{{ pairTarget.username }}" mit Telegram verknüpfen
        </h2>

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
        <template v-else-if="pairToken">
          <!-- Schritt 1: Welcher Bot? -->
          <div class="pair-step">
            <div class="pair-step-label"><span class="pair-step-num">1</span> Bot in Telegram öffnen</div>
            <div class="pair-step-body">
              <template v-if="pairBotUsername">
                <a
                  :href="pairBotLink ?? '#'"
                  target="_blank"
                  rel="noopener"
                  class="patio-btn solid sm"
                  style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none"
                >
                  <BIcon name="message" :size="11" />
                  @{{ pairBotUsername }} öffnen
                </a>
                <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 6px">
                  Falls noch nie genutzt: erst <code class="inline-cmd">/start</code> schicken.
                </div>
              </template>
              <div v-else style="font-size: 12px; color: var(--color-warning-text, #b45309)">
                Kein Bot bekannt. Wenn der User einen <strong>eigenen Bot</strong> nutzen soll, muss er sich erst
                einloggen → Settings → „Mein Telegram-Bot" einrichten. Sonst muss der
                <code class="inline-cmd">BOT_TOKEN</code> in der <code class="inline-cmd">.env</code> gesetzt sein.
              </div>
            </div>
          </div>

          <!-- Schritt 2: Befehl senden -->
          <div class="pair-step">
            <div class="pair-step-label"><span class="pair-step-num">2</span> Diesen Befehl in den Chat kopieren</div>
            <div class="pair-step-body">
              <div class="pair-cmd-box">
                <code class="pair-cmd">{{ pairCommand }}</code>
                <button class="patio-btn ghost sm" @click="copyPairCommand" title="Befehl kopieren">Kopieren</button>
              </div>
              <div
                v-if="copyMessage"
                :style="{
                  fontSize: '11px',
                  marginTop: '4px',
                  color: copyMessage.type === 'success' ? 'var(--color-success-text)' : 'var(--color-danger-text)',
                }"
              >
                {{ copyMessage.text }}
              </div>
            </div>
          </div>

          <!-- Meta: Gültigkeit -->
          <div class="pair-meta">
            <span>Gültig noch:</span>
            <span class="font-mono" :class="{ 'pair-token-expired': pairCountdown === 'abgelaufen' }">
              {{ pairCountdown }}
            </span>
            <button
              class="patio-btn ghost sm"
              @click="copyToken"
              :title="'Nur Code kopieren'"
              style="margin-left: auto"
            >
              Nur Code
            </button>
          </div>
        </template>

        <div class="flex items-center justify-end" style="gap: 8px; margin-top: 20px">
          <button class="patio-btn solid" @click="closePairDialog">Schließen</button>
        </div>
      </div>
    </div>

    <!-- Bot-Token-Dialog (Admin-Override) -->
    <div v-if="showBotDialog && botTarget" class="modal-overlay" @click.self="closeBotTokenDialog">
      <div class="modal-card" style="max-width: 540px">
        <div class="eyebrow" style="margin-bottom: 4px">Telegram-Bot</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 14px 0">Bot für „{{ botTarget.username }}"</h2>

        <!-- Status-Block -->
        <div v-if="botStatus" class="bot-status-block">
          <span
            class="bot-status-dot"
            :class="
              botStatus.botRunning
                ? 'bot-status-active'
                : botStatus.hasToken
                  ? 'bot-status-error'
                  : 'bot-status-inactive'
            "
          ></span>
          <div style="flex: 1">
            <div style="font-size: 13px; font-weight: 600; color: var(--color-text)">
              <template v-if="botStatus.botRunning && botStatus.botUsername">
                Bot @{{ botStatus.botUsername }} läuft
              </template>
              <template v-else-if="botStatus.hasToken">Token gesetzt, aber Bot läuft nicht</template>
              <template v-else>Noch kein Bot eingerichtet</template>
            </div>
            <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px">
              <template v-if="botStatus.chatId">
                gepairt mit Chat
                <span class="font-mono">{{ botStatus.chatId }}</span>
              </template>
              <template v-else-if="botStatus.botRunning">
                Noch nicht gepairt — separat über „Telegram pairen" einen Code generieren.
              </template>
              <template v-else-if="botStatus.hasToken">
                Token bei @BotFather noch gültig? Sonst neuen erzeugen.
              </template>
              <template v-else>Token aus @BotFather unten eintragen.</template>
            </div>
          </div>
        </div>

        <!-- Anleitung -->
        <ol class="bot-steps">
          <li>
            Bot bei
            <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="bot-link">@BotFather</a>
            anlegen → <code class="inline-cmd">/newbot</code> → Anweisungen folgen.
          </li>
          <li>
            Token ähnlich
            <code class="inline-cmd">123456789:AAE…</code> hier eintragen + speichern.
          </li>
          <li>Danach „Telegram pairen" ausführen, damit der User selbst seinen Chat verlinkt.</li>
        </ol>

        <!-- Token-Eingabe -->
        <div class="flex items-center gap-3" style="margin-top: 8px">
          <input
            v-model="botTokenInput"
            type="password"
            placeholder="123456789:ABC-DEF... (von @BotFather)"
            class="settings-input flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
            style="
              min-width: 0;
              border: 1px solid var(--color-border);
              background: var(--color-bg);
              color: var(--color-text);
            "
            :class="{ 'bot-input-invalid': botTokenInput.length > 0 && !botTokenValid }"
          />
          <button
            class="patio-btn solid"
            :disabled="botDialogSaving || !botTokenValid"
            :style="{ opacity: botDialogSaving || !botTokenValid ? 0.5 : 1 }"
            @click="saveBotToken"
          >
            {{ botDialogSaving ? "…" : botStatus?.hasToken ? "Bot wechseln" : "Bot einrichten" }}
          </button>
        </div>
        <div
          v-if="botTokenInput.length > 0 && !botTokenValid"
          style="font-size: 11px; color: var(--color-warning-text, #b45309); margin-top: 6px"
        >
          Format passt nicht — Telegram-Tokens sehen so aus:
          <span class="font-mono">123456789:ABCdefGHI-JKL_mnoPQR_stuVWXyz0123456</span>
        </div>

        <!-- Status-Messages -->
        <p v-if="botDialogMessage" style="font-size: 12px; color: var(--color-success-text); margin-top: 12px">
          {{ botDialogMessage }}
        </p>
        <p
          v-if="botDialogError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ botDialogError }}
        </p>

        <!-- Footer-Actions -->
        <div class="flex items-center justify-between" style="gap: 8px; margin-top: 20px">
          <button
            v-if="botStatus?.hasToken"
            class="patio-btn ghost"
            :disabled="botDialogSaving"
            @click="removeBotToken"
          >
            Bot entfernen
          </button>
          <span v-else></span>
          <button class="patio-btn solid" @click="closeBotTokenDialog">Schließen</button>
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

.patio-btn.sm {
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

/* Neuer step-by-step Pair-Dialog */
.pair-step {
  margin-bottom: 14px;
}
.pair-step-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 6px;
}
.pair-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--color-text);
  color: var(--color-bg);
  font-size: 11px;
  font-weight: 700;
}
.pair-step-body {
  padding-left: 26px;
}
.pair-cmd-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}
.pair-cmd {
  font-family: var(--font-mono, monospace);
  font-size: 14px;
  color: var(--color-text);
  flex: 1;
  user-select: all;
  word-break: break-all;
}
.pair-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-subtle);
}
.inline-cmd {
  font-family: var(--font-mono, monospace);
  background: var(--color-bg-subtle);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}

/* ── Bot-Token-Dialog ─────────────────────────────────────── */
.bot-status-block {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}
.bot-status-block .bot-status-dot {
  margin-top: 5px;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.bot-status-active {
  background: var(--color-success-text, #16a34a);
}
.bot-status-error {
  background: var(--color-warning-text, #b45309);
}
.bot-status-inactive {
  background: var(--color-text-faint);
}
.bot-steps {
  list-style: decimal;
  padding-left: 20px;
  margin: 0 0 14px 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.7;
}
.bot-steps li {
  margin-bottom: 4px;
}
.bot-link {
  color: var(--color-primary);
  text-decoration: underline;
}
.bot-input-invalid {
  border-color: var(--color-warning-text, #b45309) !important;
}

/* ── Nutzer-Liste — Layouts ────────────────────────────────── */
.users-list-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.users-list-inner {
  /* Desktop: min-width damit die Spalten nicht zerquetschen.
     Summe: 1fr Name + 90 Rolle + 70 Tg + 100 Datum + 148 Aktionen + Gaps. */
  min-width: 700px;
}
.users-list-header {
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}
/* Mobile-Meta-Zeile (Rolle/Telegram/Datum als Chips) — Default hidden,
   wird unter 768px aktiviert. */
.user-meta-mobile {
  display: none;
}

@media (max-width: 767.98px) {
  /* Card-Layout statt Tabelle */
  .users-list-wrap {
    overflow-x: visible;
  }
  .users-list-inner {
    min-width: 0;
  }
  .users-list-header {
    display: none;
  }
  /* Spalten-Divs verstecken — Daten wandern in die Mobile-Meta-Zeile */
  .user-col-role,
  .user-col-telegram,
  .user-col-date {
    display: none !important;
  }
  /* Mobile-Meta-Zeile sichtbar */
  .user-meta-mobile {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-top: 8px;
    align-items: center;
  }
  .user-meta-mobile .role-btn {
    /* Etwas kompakter im Mobile-Layout */
    padding: 2px 8px !important;
  }
  .user-meta-text {
    font-size: 11px;
    color: var(--color-text-muted);
  }
  /* Action-Buttons rutschen unter den Namen-Block — flex-wrap auf der Row */
  .user-row {
    flex-wrap: wrap !important;
    align-items: flex-start !important;
    gap: 8px 12px !important;
    padding: 12px 14px !important;
  }
  .user-name-block {
    flex: 1 1 100% !important;
  }
  .user-actions {
    flex: 1 1 100%;
    justify-content: flex-start !important;
    gap: 6px !important;
    padding-top: 4px;
    border-top: 1px solid var(--color-border-subtle);
  }
  /* Touch-Targets in der Mobile-Action-Reihe etwas groesser */
  .user-actions .row-action {
    width: 40px !important;
    height: 40px !important;
    min-width: 40px !important;
    min-height: 40px !important;
  }
}
</style>
