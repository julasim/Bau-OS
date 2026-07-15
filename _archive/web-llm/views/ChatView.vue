<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";
import { api, getToken, clearToken } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import BIcon from "../components/BIcon.vue";
import { useConfirm } from "../composables/useConfirm";

const { confirm } = useConfirm();

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
}

interface SessionInfo {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

const messages = ref<ChatMessage[]>([]);
const input = ref("");
const loading = ref(false);
const toolCalls = ref<string[]>([]);
const chatContainer = ref<HTMLElement | null>(null);
const sessions = ref<SessionInfo[]>([]);
const activeSessionId = ref<string | null>(null);
// Mobile-Default: Sidebar geschlossen — User oeffnet sie via Hamburger
// im Conversation-Header. Desktop: standardmaessig offen.
const sidebarOpen = ref(typeof window !== "undefined" ? window.innerWidth >= 768 : true);
const abortCtrl = ref<AbortController | null>(null);

// ── Dateisuche-Mode ──────────────────────────────────────────────────────────
const searchMode = ref(false);
const projectFilter = ref<string | null>(null);
const showAttachMenu = ref(false);
const projects = ref<{ name: string }[]>([]);
const attachMenuRef = ref<HTMLElement | null>(null);

async function loadProjects() {
  try {
    projects.value = await api.get<{ name: string }[]>("/projects");
  } catch {
    projects.value = [];
  }
}

function toggleAttachMenu() {
  showAttachMenu.value = !showAttachMenu.value;
}

function onDocClick(e: MouseEvent) {
  if (!showAttachMenu.value) return;
  const target = e.target as Node;
  if (attachMenuRef.value && !attachMenuRef.value.contains(target)) {
    showAttachMenu.value = false;
  }
}

// ── Sessions gruppieren ──────────────────────────────────────────────────────
const groupedSessions = computed(() => {
  const groups: { label: string; items: SessionInfo[] }[] = [];
  const todayGroup: SessionInfo[] = [];
  const yesterdayGroup: SessionInfo[] = [];
  const weekGroup: SessionInfo[] = [];
  const olderGroup: SessionInfo[] = [];

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);

  for (const s of sessions.value) {
    const d = s.updatedAt.slice(0, 10);
    if (d === todayStr) todayGroup.push(s);
    else if (d === yesterdayStr) yesterdayGroup.push(s);
    else if (new Date(s.updatedAt) >= weekAgo) weekGroup.push(s);
    else olderGroup.push(s);
  }

  if (todayGroup.length) groups.push({ label: "Heute", items: todayGroup });
  if (yesterdayGroup.length) groups.push({ label: "Gestern", items: yesterdayGroup });
  if (weekGroup.length) groups.push({ label: "Diese Woche", items: weekGroup });
  if (olderGroup.length) groups.push({ label: "Aelter", items: olderGroup });

  return groups;
});

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

// ── Sessions laden ───────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    sessions.value = await api.get<SessionInfo[]>("/chat/sessions");
  } catch {
    sessions.value = [];
  }
}

async function selectSession(id: string) {
  activeSessionId.value = id;
  messages.value = [];
  // Auf Mobile (Drawer-Mode): Sidebar nach Auswahl schliessen, sonst
  // verdeckt sie die Conversation.
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    sidebarOpen.value = false;
  }
  try {
    const msgs = await api.get<{ role: string; content: string; tools: string[] }[]>(`/chat/sessions/${id}/messages`);
    for (const m of msgs) {
      if (m.role === "user" || m.role === "assistant") {
        messages.value.push({
          role: m.role,
          text: m.content,
          tools: m.tools?.length ? m.tools : undefined,
        });
      }
    }
    scrollToBottom();
  } catch {
    // Laden fehlgeschlagen
  }
}

async function newChat() {
  activeSessionId.value = null;
  messages.value = [];
  input.value = "";
  // Mobile: Sidebar zu, damit der Eingabe-Fokus auf der Conversation liegt.
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    sidebarOpen.value = false;
  }
}

async function deleteSession(id: string) {
  if (!(await confirm({ message: "Chat wirklich loeschen?", confirmDanger: true }))) return;
  try {
    await api.delete(`/chat/sessions/${id}`);
    if (activeSessionId.value === id) {
      activeSessionId.value = null;
      messages.value = [];
    }
    await loadSessions();
  } catch {
    // Loeschen fehlgeschlagen
  }
}

// ── Nachricht senden ─────────────────────────────────────────────────────────
async function send() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  messages.value.push({ role: "user", text });
  input.value = "";
  loading.value = true;
  toolCalls.value = [];
  scrollToBottom();

  const token = getToken();

  // Alten Stream canceln, falls noch aktiv
  if (abortCtrl.value) {
    abortCtrl.value.abort();
  }
  abortCtrl.value = new AbortController();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: text,
        sessionId: activeSessionId.value || undefined,
        searchMode: searchMode.value,
        projectFilter: projectFilter.value,
      }),
      signal: abortCtrl.value.signal,
    });

    // 401: Token ungueltig — konsistent mit api.ts behandeln
    if (res.status === 401) {
      clearToken();
      window.location.href = "/login";
      return;
    }

    if (!res.ok || !res.body) {
      messages.value.push({ role: "assistant", text: "Fehler bei der Verbindung." });
      loading.value = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const collectedTools: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) continue;
        if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          try {
            const data = JSON.parse(raw);
            if (data.sessionId) {
              // Session-ID vom Server erhalten (bei neuer Session)
              activeSessionId.value = data.sessionId;
            } else if (data.status) {
              // thinking
            } else if (data.tool) {
              collectedTools.push(data.tool);
              toolCalls.value = [...collectedTools];
              scrollToBottom();
            } else if (data.text) {
              messages.value.push({
                role: "assistant",
                text: data.text,
                tools: collectedTools.length > 0 ? [...collectedTools] : undefined,
              });
              scrollToBottom();
            } else if (data.error) {
              messages.value.push({ role: "assistant", text: `Fehler: ${data.error}` });
            }
          } catch {
            // skip
          }
        }
      }
    }

    // Sessions-Liste aktualisieren
    await loadSessions();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    messages.value.push({ role: "assistant", text: "Verbindung zum Server verloren." });
  } finally {
    loading.value = false;
    toolCalls.value = [];
    scrollToBottom();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

// ── Session-Teilen ───────────────────────────────────────────────────────────
interface ShareUser {
  userId: string;
  username: string;
  displayName: string | null;
  addedAt: string;
}
const shareSessionId = ref<string | null>(null);
const shareSessionShares = ref<ShareUser[]>([]);
const shareSearchTerm = ref("");
const shareBusy = ref(false);
const shareOpen = computed(() => shareSessionId.value !== null);

// allUsers wird für den Picker gebraucht — lade einmalig
const allUsers = ref<{ id: string; username: string; displayName: string | null }[]>([]);
async function loadUsers() {
  if (allUsers.value.length > 0) return;
  try {
    allUsers.value = await api.get<(typeof allUsers.value)[0][]>("/users/mini");
  } catch {
    /* ignore */
  }
}

const shareCandidates = computed(() =>
  allUsers.value.filter(
    (u) =>
      !shareSessionShares.value.some((s) => s.userId === u.id) &&
      (u.username.includes(shareSearchTerm.value) ||
        (u.displayName ?? "").toLowerCase().includes(shareSearchTerm.value.toLowerCase())),
  ),
);

async function openShareSession(sessionId: string) {
  shareSessionId.value = sessionId;
  shareSessionShares.value = [];
  shareSearchTerm.value = "";
  await Promise.all([loadUsers(), loadSharesForSession(sessionId)]);
}

async function loadSharesForSession(sessionId: string) {
  try {
    shareSessionShares.value = await api.get<ShareUser[]>(`/chat/sessions/${sessionId}/shares`);
  } catch {
    shareSessionShares.value = [];
  }
}

async function addSessionShare(userId: string) {
  if (!shareSessionId.value) return;
  shareBusy.value = true;
  try {
    await api.post(`/chat/sessions/${shareSessionId.value}/shares`, { userId });
    await loadSharesForSession(shareSessionId.value);
  } finally {
    shareBusy.value = false;
  }
}

async function removeSessionShare(userId: string) {
  if (!shareSessionId.value) return;
  shareBusy.value = true;
  try {
    await api.delete(`/chat/sessions/${shareSessionId.value}/shares/${encodeURIComponent(userId)}`);
    await loadSharesForSession(shareSessionId.value);
  } finally {
    shareBusy.value = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadSessions(), loadProjects()]);
  // Neueste Session oeffnen falls vorhanden
  if (sessions.value.length > 0) {
    await selectSession(sessions.value[0].id);
  }
  document.addEventListener("mousedown", onDocClick);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocClick);
  abortCtrl.value?.abort();
});
</script>

<template>
  <div class="cv-root">
    <!-- Mobile-Backdrop fuer Sidebar-Drawer (nur auf <768px sichtbar via CSS) -->
    <div v-if="sidebarOpen" class="chat-sidebar-backdrop" @click="sidebarOpen = false"></div>

    <!-- Session-Sidebar -->
    <aside v-if="sidebarOpen" class="chat-sidebar">
      <!-- Header: Neuer Chat -->
      <div class="cv-sidebar-head">
        <button @click="newChat" class="cv-new-chat-btn">
          <BIcon name="plus" :size="13" :stroke-width="2" />
          Neuer Chat
        </button>
      </div>

      <!-- Session-Liste -->
      <nav class="cv-session-nav">
        <div v-for="group in groupedSessions" :key="group.label" class="cv-session-group">
          <div class="cv-session-group-label">{{ group.label }}</div>
          <div
            v-for="session in group.items"
            :key="session.id"
            @click="selectSession(session.id)"
            :class="['cv-session-item', activeSessionId === session.id ? 'cv-session-item--active' : '']"
          >
            <span class="cv-session-title" :title="session.lastMessage || session.title">
              {{ session.lastMessage || session.title }}
            </span>
            <button
              class="cv-session-action chat-session-share-btn"
              @click.stop="openShareSession(session.id)"
              title="Freigeben"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            <button @click.stop="deleteSession(session.id)" class="cv-session-action session-del" aria-label="Loeschen">
              <BIcon name="x" :size="12" />
            </button>
          </div>
        </div>
        <div v-if="sessions.length === 0" class="cv-session-empty">Noch keine Chats</div>
      </nav>

      <!-- Model-Indicator -->
      <div class="cv-sidebar-foot">
        <span class="pt-dot pt-dot--success"></span>
        <span class="cv-sidebar-foot-label">Main</span>
      </div>
    </aside>

    <!-- Conversation-Bereich -->
    <div class="cv-main">
      <!-- Strip: Agent-Info -->
      <div class="tg-strip">
        <span class="tg-bot">
          <span class="pt-avatar pt-avatar--sm tg-bot-av">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <circle cx="12" cy="12" r="9" />
              <rect x="9" y="9" width="6" height="6" rx="0.5" />
            </svg>
          </span>
          PATIO-Agent
        </span>
        <span class="tg-handle">@patio_agent</span>
        <span class="cv-strip-spacer"></span>
        <button
          @click="sidebarOpen = !sidebarOpen"
          class="cv-toggle-btn"
          :aria-label="sidebarOpen ? 'Sidebar schliessen' : 'Sidebar oeffnen'"
        >
          <BIcon name="list" :size="14" />
        </button>
        <span class="tg-conn">
          <span class="pt-dot pt-dot--success"></span>
          verbunden
        </span>
      </div>

      <!-- Nachrichten-Thread -->
      <div ref="chatContainer" class="tg-thread">
        <div class="tg-thread-inner">
          <!-- Leer-Zustand -->
          <div v-if="messages.length === 0 && !loading" class="cv-empty">Starte ein Gespraech mit dem KI-Agenten.</div>

          <div class="pt-chat tg-msg-list">
            <template v-for="(msg, i) in messages" :key="i">
              <!-- User-Nachricht -->
              <div v-if="msg.role === 'user'" class="pt-msg-row pt-msg-row--user">
                <div>
                  <div class="pt-msg pt-msg--user">{{ msg.text }}</div>
                </div>
              </div>

              <!-- Bot-Nachricht -->
              <div v-else class="pt-msg-row">
                <span class="pt-avatar pt-avatar--sm tg-bot-av">
                  <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <rect x="9" y="9" width="6" height="6" rx="0.5" />
                  </svg>
                </span>
                <div class="cv-bot-body">
                  <!-- Tool-Calls, die dieser Antwort vorausgingen -->
                  <template v-if="msg.tools && msg.tools.length > 0">
                    <div v-for="tool in msg.tools" :key="tool" class="pt-toolcall">
                      <div class="pt-toolcall-head">
                        <svg
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          width="12"
                          height="12"
                        >
                          <rect x="4" y="4" width="16" height="16" rx="2" />
                          <rect x="9" y="9" width="6" height="6" />
                          <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
                        </svg>
                        Tool-Call
                      </div>
                      <div class="pt-toolcall-body">
                        <span class="pt-tc-fn">{{ tool }}</span>
                      </div>
                      <div class="pt-toolcall-foot">
                        <svg
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          width="11"
                          height="11"
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        ausgefuehrt
                      </div>
                    </div>
                  </template>
                  <div class="pt-msg pt-msg--bot">
                    <MarkdownRenderer :content="msg.text" />
                  </div>
                </div>
              </div>
            </template>

            <!-- Typing-Indicator / Tool-Calls waehrend Laden -->
            <div v-if="loading" class="pt-msg-row">
              <span class="pt-avatar pt-avatar--sm tg-bot-av">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                  <circle cx="12" cy="12" r="9" />
                  <rect x="9" y="9" width="6" height="6" rx="0.5" />
                </svg>
              </span>
              <div class="cv-bot-body">
                <!-- Laufende Tool-Calls anzeigen -->
                <template v-if="toolCalls.length > 0">
                  <div v-for="tool in toolCalls" :key="tool" class="pt-toolcall">
                    <div class="pt-toolcall-head">
                      <svg
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        width="12"
                        height="12"
                      >
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
                      </svg>
                      Tool-Call
                    </div>
                    <div class="pt-toolcall-body">
                      <span class="pt-tc-fn">{{ tool }}</span>
                    </div>
                  </div>
                </template>
                <!-- Typing-Dots -->
                <div class="pt-msg pt-msg--bot cv-typing-wrap">
                  <span class="pt-typing"> <span></span><span></span><span></span> </span>
                  <span v-if="toolCalls.length === 0" class="cv-thinking-label">Denkt nach</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Composer -->
      <div class="tg-composer">
        <div class="tg-composer-inner">
          <!-- Dateisuche-Status-Pille -->
          <div v-if="searchMode" class="cv-search-pill-row">
            <span class="cv-search-pill">
              <BIcon name="search" :size="11" />
              Dateisuche aktiv
              <span v-if="projectFilter" class="cv-search-pill-project">· {{ projectFilter }}</span>
              <button
                @click="
                  searchMode = false;
                  projectFilter = null;
                "
                class="cv-search-pill-close"
                aria-label="Dateisuche deaktivieren"
              >
                <BIcon name="x" :size="10" />
              </button>
            </span>
          </div>

          <!-- Input-Zeile -->
          <div class="tg-composer-row" ref="attachMenuRef" style="position: relative">
            <div class="cv-composer-wrap">
              <button @click="toggleAttachMenu" :disabled="loading" class="cv-composer-icon" title="Werkzeuge">
                <BIcon name="plus" :size="14" />
              </button>
              <textarea
                v-model="input"
                @keydown="onKeydown"
                :disabled="loading"
                placeholder="Nachricht oder Diktat an den Agenten ..."
                rows="1"
                class="pt-textarea cv-textarea"
              />
              <button
                @click="send"
                :disabled="loading || !input.trim()"
                class="pt-btn pt-btn--primary cv-send-btn"
                aria-label="Senden"
              >
                <svg
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="14"
                  height="14"
                >
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
                </svg>
                Senden
              </button>
            </div>

            <!-- Werkzeug-Popover -->
            <div v-if="showAttachMenu" class="cv-attach-popover">
              <label class="cv-attach-row">
                <input type="checkbox" v-model="searchMode" class="cv-attach-check" />
                <span class="cv-attach-label">Dateisuche aktivieren</span>
              </label>
              <p class="cv-attach-hint">Der Assistent durchsucht deinen Workspace vor jeder Antwort.</p>
              <div v-if="searchMode" class="cv-attach-project">
                <div class="pt-nav-label" style="margin-bottom: 4px">Projekt</div>
                <select v-model="projectFilter" class="cv-attach-select">
                  <option :value="null">Alle Projekte</option>
                  <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="tg-hint">Lokal gehostet &middot; Antworten koennen Fehler enthalten.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ─── Session-Teilen-Modal ─────────────────────────────── -->
  <div v-if="shareOpen" class="chat-share-overlay" @click.self="shareSessionId = null">
    <div class="chat-share-modal">
      <div class="chat-share-header">
        <span>Session freigeben</span>
        <button @click="shareSessionId = null" class="cv-share-close" aria-label="Schliessen">
          <BIcon name="x" :size="16" />
        </button>
      </div>
      <!-- Aktuelle Freigaben -->
      <div v-if="shareSessionShares.length > 0" class="chat-share-current">
        <div class="chat-share-label">Freigegeben fuer:</div>
        <div v-for="s in shareSessionShares" :key="s.userId" class="chat-share-entry">
          <span>{{ s.displayName ?? s.username }}</span>
          <button @click="removeSessionShare(s.userId)" :disabled="shareBusy" class="chat-share-remove">
            Entfernen
          </button>
        </div>
      </div>
      <!-- Benutzer hinzufuegen -->
      <div class="chat-share-add">
        <input v-model="shareSearchTerm" type="text" placeholder="Benutzer suchen ..." class="chat-share-input" />
        <div class="chat-share-candidates">
          <button
            v-for="u in shareCandidates.slice(0, 20)"
            :key="u.id"
            @click="addSessionShare(u.id)"
            :disabled="shareBusy"
            class="chat-share-candidate"
          >
            {{ u.displayName ?? u.username }}
            <span class="cv-share-username">@{{ u.username }}</span>
          </button>
          <div v-if="shareCandidates.length === 0" class="cv-share-empty">
            {{ shareSearchTerm ? "Keine Treffer." : "Alle Nutzer wurden bereits hinzugefuegt." }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Root-Layout ─────────────────────────────────────────── */
.cv-root {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--surface);
}

/* ── Sidebar ─────────────────────────────────────────────── */
.chat-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 260px;
  background: var(--surface-dark, #111827);
  border-right: 1px solid var(--border-dark-strong, rgba(255, 255, 255, 0.08));
  overflow: hidden;
}

.cv-sidebar-head {
  padding: 12px 10px 8px;
  flex-shrink: 0;
}

.cv-new-chat-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border-dark-strong, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 6px);
  background: transparent;
  color: var(--fg-dark, rgba(255, 255, 255, 0.75));
  font-size: var(--fs-13, 13px);
  font-weight: var(--fw-medium, 500);
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.cv-new-chat-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg-dark-strong, #fff);
}

/* Session-Navitation */
.cv-session-nav {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
}

.cv-session-group {
  margin-bottom: 14px;
}

.cv-session-group-label {
  padding: 0 10px;
  margin-bottom: 4px;
  font-family: var(--font-mono);
  font-size: var(--fs-11, 11px);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label, 0.06em);
  color: var(--fg-subtle-dark, rgba(255, 255, 255, 0.35));
}

.cv-session-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 10px;
  border-radius: var(--radius-md, 6px);
  font-size: var(--fs-13, 13px);
  color: var(--fg-dark-muted, rgba(255, 255, 255, 0.55));
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease;
  border: 1px solid transparent;
}
.cv-session-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg-dark, rgba(255, 255, 255, 0.85));
}
.cv-session-item--active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: var(--fg-dark-strong, #fff);
}

.cv-session-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Action-Buttons in session items */
.cv-session-action {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  color: rgba(255, 255, 255, 0.35);
  opacity: 0;
  transition:
    opacity 150ms,
    color 150ms,
    background 150ms;
}
.cv-session-item:hover .cv-session-action,
.cv-session-item--active .cv-session-action {
  opacity: 1;
}
.cv-session-action:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
}
.session-del:hover {
  color: var(--danger-fg, #f87171);
}

.cv-session-empty {
  padding: 16px 10px;
  font-size: var(--fs-11, 11px);
  color: var(--fg-subtle-dark, rgba(255, 255, 255, 0.3));
  text-align: center;
}

/* Sidebar Footer */
.cv-sidebar-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.cv-sidebar-foot-label {
  font-family: var(--font-mono);
  font-size: var(--fs-11, 11px);
  color: var(--fg-subtle-dark, rgba(255, 255, 255, 0.4));
}

/* Mobile Drawer Backdrop */
.chat-sidebar-backdrop {
  display: none;
}

@media (max-width: 767.98px) {
  .chat-sidebar {
    position: fixed !important;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 50;
    width: min(280px, 85vw) !important;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.35);
  }
  .chat-sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 40;
  }
}

/* ── Main Conversation ───────────────────────────────────── */
.cv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--surface);
}

/* ── TG-Strip (Bot-Header) ───────────────────────────────── */
.tg-strip {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-3, 10px);
  padding: 10px var(--space-6, 24px);
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
}
.tg-bot {
  display: flex;
  align-items: center;
  gap: var(--space-2, 6px);
  font-size: var(--fs-13, 13px);
  font-weight: var(--fw-medium, 500);
  color: var(--fg-body);
}
.tg-handle {
  font-family: var(--font-mono);
  font-size: var(--fs-12, 12px);
  color: var(--fg-muted);
}
.tg-conn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-12, 12px);
  color: var(--success-fg);
}
.cv-strip-spacer {
  flex: 1;
}
.cv-toggle-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--fg-muted);
  transition:
    background 140ms,
    color 140ms;
}
.cv-toggle-btn:hover {
  background: var(--surface-raised);
  color: var(--fg-body);
}

/* Bot-Avatar in dark surfaces */
.tg-bot-av {
  background: var(--accent, #2563eb);
  border-color: var(--accent, #2563eb);
  color: #fff;
}
.tg-bot-av svg {
  width: 13px;
  height: 13px;
}

/* ── Thread ──────────────────────────────────────────────── */
.tg-thread {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.tg-thread-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-8, 32px) var(--space-6, 24px) var(--space-6, 24px);
}

.cv-empty {
  text-align: center;
  padding: 60px 0 24px;
  font-size: var(--fs-13, 13px);
  color: var(--fg-subtle);
}

/* Message list */
.tg-msg-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 14px);
}

/* Bot row */
.pt-msg-row {
  display: flex;
  gap: var(--space-3, 10px);
  align-items: flex-start;
}

/* User row */
.pt-msg-row--user {
  justify-content: flex-end;
}

/* Bot body wrapper */
.cv-bot-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 6px);
}

/* ── Messages ────────────────────────────────────────────── */
.pt-msg {
  font-size: var(--fs-14, 14px);
  line-height: 1.65;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}

.pt-msg--bot {
  padding: 10px 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 2px var(--radius-lg, 10px) var(--radius-lg, 10px) var(--radius-lg, 10px);
  color: var(--fg-body);
}

.pt-msg--user {
  display: inline-block;
  padding: 9px 14px;
  background: var(--accent, #2563eb);
  color: #fff;
  border-radius: var(--radius-lg, 10px) var(--radius-lg, 10px) 2px var(--radius-lg, 10px);
  max-width: 80%;
}

/* Markdown in bot messages */
.pt-msg--bot :deep(p) {
  margin: 0 0 10px 0;
}
.pt-msg--bot :deep(p:last-child) {
  margin-bottom: 0;
}
.pt-msg--bot :deep(strong),
.pt-msg--bot :deep(b) {
  font-weight: 600;
}
.pt-msg--bot :deep(h1),
.pt-msg--bot :deep(h2),
.pt-msg--bot :deep(h3) {
  font-size: var(--fs-14, 14px);
  font-weight: 600;
  margin: 14px 0 6px 0;
}
.pt-msg--bot :deep(ul),
.pt-msg--bot :deep(ol) {
  margin: 0 0 10px 0;
  padding-left: 20px;
}
.pt-msg--bot :deep(li) {
  margin: 2px 0;
}
.pt-msg--bot :deep(li)::marker {
  color: var(--fg-subtle);
}
.pt-msg--bot :deep(code) {
  font-size: var(--fs-12, 12px);
  font-family: var(--font-mono);
  background: var(--surface-raised);
  padding: 1px 5px;
  border-radius: 3px;
}
.pt-msg--bot :deep(pre) {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  padding: 10px 12px;
  border-radius: var(--radius-md, 6px);
  overflow-x: auto;
  margin: 8px 0;
}
.pt-msg--bot :deep(pre code) {
  background: transparent;
  padding: 0;
}
.pt-msg--bot :deep(blockquote) {
  border-left: 2px solid var(--border-strong);
  margin: 0 0 10px 0;
  padding: 0 0 0 12px;
  color: var(--fg-muted);
}
.pt-msg--bot :deep(a) {
  color: var(--fg-body);
  font-weight: var(--fw-medium, 500);
  text-decoration: none;
  border-bottom: 1px solid var(--border-strong);
}
.pt-msg--bot :deep(a:hover) {
  border-bottom-color: var(--fg-body);
}

/* ── Tool-Call ───────────────────────────────────────────── */
.pt-toolcall {
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
  font-size: var(--fs-12, 12px);
}
.pt-toolcall-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: var(--fs-11, 11px);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label, 0.05em);
  color: var(--fg-muted);
}
.pt-toolcall-body {
  padding: 7px 10px;
  font-family: var(--font-mono);
  font-size: var(--fs-12, 12px);
  color: var(--fg-body);
  white-space: pre-wrap;
  word-break: break-word;
}
.pt-tc-fn {
  color: var(--accent, #2563eb);
  font-weight: var(--fw-medium, 500);
}
.pt-toolcall-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: var(--surface-subtle);
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: var(--fs-11, 11px);
  color: var(--success-fg);
}

/* ── Typing Indicator ────────────────────────────────────── */
.cv-typing-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
}
.pt-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pt-typing span {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--fg-subtle);
  animation: pt-bounce 1.2s infinite ease-in-out;
}
.pt-typing span:nth-child(2) {
  animation-delay: 0.2s;
}
.pt-typing span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes pt-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
.cv-thinking-label {
  font-size: var(--fs-12, 12px);
  color: var(--fg-subtle);
}

/* ── Composer ────────────────────────────────────────────── */
.tg-composer {
  flex: none;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: var(--space-4, 14px) var(--space-6, 24px) var(--space-5, 18px);
}
.tg-composer-inner {
  max-width: 720px;
  margin: 0 auto;
}
.tg-composer-row {
  position: relative;
}
.cv-composer-wrap {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2, 6px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 10px);
  padding: 6px 8px;
  background: var(--surface);
  transition: border-color 150ms;
}
.cv-composer-wrap:focus-within {
  border-color: var(--border-strong);
}

.cv-textarea {
  flex: 1;
  min-height: 28px;
  max-height: 180px;
  border: none !important;
  background: transparent !important;
  resize: none;
  font-size: var(--fs-14, 14px);
  line-height: 1.5;
  padding: 2px 4px;
  outline: none;
  color: var(--fg-body);
  font-family: inherit;
}

.cv-composer-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--fg-muted);
  transition:
    background 140ms,
    color 140ms;
}
.cv-composer-icon:hover {
  background: var(--surface-raised);
  color: var(--fg-body);
}
.cv-composer-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cv-send-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  height: 30px;
  font-size: var(--fs-13, 13px);
}

.tg-hint {
  font-family: var(--font-mono);
  font-size: var(--fs-11, 11px);
  color: var(--fg-subtle);
  margin-top: var(--space-2, 6px);
  text-align: center;
}

/* Dateisuche-Pille */
.cv-search-pill-row {
  display: flex;
  margin-bottom: 8px;
}
.cv-search-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 9999px;
  background: var(--surface-subtle);
  font-size: var(--fs-11, 11px);
  color: var(--fg-muted);
}
.cv-search-pill-project {
  font-family: var(--font-mono);
  color: var(--fg-subtle);
}
.cv-search-pill-close {
  background: transparent;
  border: none;
  color: var(--fg-subtle);
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  display: inline-flex;
  align-items: center;
}

/* Werkzeug-Popover */
.cv-attach-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 288px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 10px);
  padding: 14px;
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.1));
  z-index: 10;
}
.cv-attach-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.cv-attach-check {
  accent-color: var(--accent);
}
.cv-attach-label {
  font-size: var(--fs-13, 13px);
  color: var(--fg-body);
}
.cv-attach-hint {
  margin: 4px 0 0 24px;
  font-size: var(--fs-11, 11px);
  color: var(--fg-subtle);
}
.cv-attach-project {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle, var(--hairline));
}
.cv-attach-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  font-size: var(--fs-13, 13px);
  outline: none;
  background: var(--surface);
  color: var(--fg-body);
}

/* ── Share Modal ─────────────────────────────────────────── */
.chat-share-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-share-modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 10px);
  padding: 20px;
  width: 380px;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat-share-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: var(--fs-15, 15px);
  color: var(--fg-body);
}
.cv-share-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--fg-muted);
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: var(--radius-sm, 4px);
}
.cv-share-close:hover {
  color: var(--fg-body);
}
.chat-share-label {
  font-size: var(--fs-11, 11px);
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.chat-share-entry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-13, 13px);
  color: var(--fg-body);
}
.chat-share-remove {
  font-size: var(--fs-11, 11px);
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 4px);
  padding: 2px 8px;
  cursor: pointer;
  color: var(--danger-fg, #dc2626);
}
.chat-share-add {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chat-share-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  background: var(--surface-subtle);
  font-size: var(--fs-13, 13px);
  color: var(--fg-body);
  outline: none;
}
.chat-share-input:focus {
  border-color: var(--border-strong);
}
.chat-share-candidates {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.chat-share-candidate {
  text-align: left;
  background: none;
  border: none;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  font-size: var(--fs-13, 13px);
  color: var(--fg-body);
}
.chat-share-candidate:hover {
  background: var(--surface-subtle);
}
.cv-share-username {
  opacity: 0.45;
  font-size: var(--fs-11, 11px);
  font-family: var(--font-mono);
  margin-left: 4px;
}
.cv-share-empty {
  font-size: var(--fs-12, 12px);
  color: var(--fg-muted);
  padding: 8px 10px;
}

/* share button in session list */
.chat-session-share-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  transition:
    opacity 0.15s,
    color 0.15s;
}
.cv-session-item:hover .chat-session-share-btn,
.cv-session-item--active .chat-session-share-btn {
  opacity: 1;
}
.chat-session-share-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}
</style>
