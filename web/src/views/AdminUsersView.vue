<script setup lang="ts">
import { formatDate as fmtDate } from "../utils/format";
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { useConfirm } from "../composables/useConfirm";
import { PASSWORD_MIN_LENGTH } from "../constants";

const { confirm } = useConfirm();

const router = useRouter();

interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  isProtected: boolean;
  /** Darf Beträge sehen (Stundensätze, Rechnungen, Budgets). Bewusst
   *  unabhängig von der Rolle — siehe Migration 043. */
  canSeeMoney?: boolean;
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

// Email ist optional — siehe SetupView. Der Server nimmt Konten ohne Adresse an.
const emailValid = computed(() => {
  const v = createForm.value.email.trim();
  return v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
});

const createCanSubmit = computed(
  () =>
    !createSaving.value &&
    createForm.value.username.trim().length >= 3 &&
    emailValid.value &&
    createForm.value.password.length >= PASSWORD_MIN_LENGTH &&
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
  if (!passwordTarget.value || passwordValue.value.length < PASSWORD_MIN_LENGTH) return;
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

/** Geld-Recht umschalten.
 *
 *  Bewusst getrennt von der Rolle: „Admin" heißt „verwaltet die Anwendung"
 *  (Konten, Vorlagen, Sicherung) — wer die Zahlen des Büros sehen darf, ist
 *  eine andere Frage. Die Buchhaltung braucht das eine ohne das andere.
 *  Admins sind serverseitig implizit berechtigt, deshalb ist der Schalter bei
 *  ihnen ohne Wirkung und bleibt gesperrt. */
async function toggleGeldRecht(user: AdminUser) {
  if (user.role === "admin") return;
  const neu = !user.canSeeMoney;
  const frage = neu
    ? `"${user.username}" darf künftig Beträge sehen — Stundensätze, Rechnungen, Budgets?`
    : `"${user.username}" die Beträge wieder entziehen?`;
  if (!(await confirm(frage))) return;
  try {
    await api.patch(`/admin/users/${encodeURIComponent(user.id)}`, { canSeeMoney: neu });
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
  return fmtDate(iso);
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
          <span class="eyebrow" style="width: 80px">Beträge</span>
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
              <!-- Mobile-Meta-Zeile: Rolle + Datum als Chips,
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
          <div class="user-col-role" style="width: 80px">
            <button
              class="role-btn"
              :class="u.role === 'admin' || u.canSeeMoney ? 'role-btn-admin' : 'role-btn-user'"
              :disabled="u.role === 'admin'"
              @click="toggleGeldRecht(u)"
              :title="
                u.role === 'admin'
                  ? 'Admins sehen Beträge immer'
                  : u.canSeeMoney
                    ? 'Sieht Beträge — zum Entziehen klicken'
                    : 'Sieht keine Beträge — zum Freigeben klicken'
              "
            >
              {{ u.role === "admin" || u.canSeeMoney ? "Beträge" : "—" }}
            </button>
          </div>
          <div class="user-col-date font-mono" style="width: 100px; font-size: 11px; color: var(--color-text-tertiary)">
            {{ formatDate(u.createdAt) }}
          </div>
          <div class="user-actions" style="display: flex; justify-content: flex-end; gap: 4px">
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
            <span class="eyebrow">Email (optional)</span>
            <input
              v-model="createForm.email"
              type="email"
              autocomplete="email"
              placeholder="name@firma.at"
              class="form-input-lg"
            />
            <span
              v-if="createForm.email.length > 0 && !emailValid"
              style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px"
            >
              Bitte eine gültige Adresse eintragen oder das Feld leer lassen.
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
            :disabled="passwordValue.length < PASSWORD_MIN_LENGTH || passwordSaving"
            @click="submitPasswordReset"
          >
            {{ passwordSaving ? "…" : "Zurücksetzen" }}
          </button>
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

/* ── Nutzer-Liste — Layouts ────────────────────────────────── */
.users-list-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.users-list-inner {
  /* Desktop: min-width damit die Spalten nicht zerquetschen.
     Summe: 1fr Name + 90 Rolle + 100 Datum + 148 Aktionen + Gaps + Padding. */
  min-width: 620px;
}
.users-list-header {
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}
/* Mobile-Meta-Zeile (Rolle/Datum als Chips) — Default hidden,
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
