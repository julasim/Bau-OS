<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import BIcon from "../components/BIcon.vue";

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
const sidebarOpen = ref(true);

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
  try {
    const msgs = await api.get<{ role: string; content: string; tools: string[] }[]>(
      `/chat/sessions/${id}/messages`,
    );
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
}

async function deleteSession(id: string) {
  if (!confirm("Chat wirklich loeschen?")) return;
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

  const token = localStorage.getItem("bau-os-token");

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
    });

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
  } catch {
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
});
</script>

<template>
  <div class="flex h-full" style="background: var(--color-bg)">
    <!-- Session-Sidebar -->
    <aside
      v-if="sidebarOpen"
      class="flex flex-col flex-shrink-0"
      style="
        width: 260px;
        border-right: 1px solid var(--color-border);
        background: var(--color-bg-subtle);
      "
    >
      <!-- Neuer Chat -->
      <div style="padding: 12px">
        <button
          @click="newChat"
          class="flex items-center gap-2"
          style="
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--color-border);
            border-radius: 6px;
            background: var(--color-bg);
            color: var(--color-text);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 180ms ease;
          "
        >
          <BIcon name="plus" :size="14" :stroke-width="2" />
          Neuer Chat
        </button>
      </div>

      <!-- Sessions -->
      <nav class="flex-1 overflow-y-auto" style="padding: 0 8px 12px">
        <div v-for="group in groupedSessions" :key="group.label" style="margin-bottom: 14px">
          <div class="eyebrow" style="padding: 0 12px; margin-bottom: 6px">
            {{ group.label }}
          </div>
          <div
            v-for="session in group.items"
            :key="session.id"
            @click="selectSession(session.id)"
            :class="['session-item', activeSessionId === session.id ? 'session-item-active' : '']"
          >
            <span class="flex-1 truncate" :title="session.lastMessage || session.title">
              {{ session.lastMessage || session.title }}
            </span>
            <button
              @click.stop="deleteSession(session.id)"
              class="session-del"
              aria-label="Löschen"
            >
              <BIcon name="x" :size="12" />
            </button>
          </div>
        </div>
        <div
          v-if="sessions.length === 0"
          style="
            padding: 16px 12px;
            font-size: 11px;
            color: var(--color-text-tertiary);
            text-align: center;
          "
        >
          Noch keine Chats
        </div>
      </nav>

      <!-- Model-Indicator -->
      <div
        style="
          padding: 10px 16px;
          border-top: 1px solid var(--color-border);
          font-size: 11px;
          color: var(--color-text-muted);
          display: flex;
          align-items: center;
          gap: 6px;
        "
      >
        <span
          style="
            width: 6px;
            height: 6px;
            border-radius: 9999px;
            background: var(--color-success);
          "
        />
        <span class="font-mono">Main</span>
      </div>
    </aside>

    <!-- Conversation -->
    <div class="flex-1 flex flex-col min-w-0" style="background: var(--color-bg)">
      <!-- Conversation-Header -->
      <div
        class="flex items-center gap-3"
        style="
          height: 48px;
          padding: 0 20px;
          border-bottom: 1px solid var(--color-border-subtle);
          flex-shrink: 0;
        "
      >
        <button
          @click="sidebarOpen = !sidebarOpen"
          class="icon-btn"
          :aria-label="sidebarOpen ? 'Sidebar schließen' : 'Sidebar öffnen'"
        >
          <BIcon name="list" :size="14" />
        </button>
        <div
          style="
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: #111827;
            color: #fff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
          "
        >
          📑
        </div>
        <div class="flex-1 min-w-0">
          <div style="font-size: 13px; font-weight: 600; color: var(--color-text)">Main</div>
          <div style="font-size: 11px; color: var(--color-text-muted)">
            professionell und freundlich
          </div>
        </div>
      </div>

      <!-- Messages -->
      <div ref="chatContainer" class="flex-1 overflow-y-auto">
        <div
          style="max-width: 760px; margin: 0 auto; padding: 32px 20px"
          class="flex flex-col gap-6"
        >
          <div
            v-if="messages.length === 0 && !loading"
            style="
              text-align: center;
              padding: 60px 0;
              font-size: 13px;
              color: var(--color-text-tertiary);
            "
          >
            Starte ein Gespräch mit dem KI-Agenten.
          </div>

          <div
            v-for="(msg, i) in messages"
            :key="i"
            class="flex"
            :style="{
              gap: '12px',
              alignItems: 'flex-start',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }"
          >
            <!-- Avatar -->
            <div
              :style="{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 600,
                background: msg.role === 'user' ? 'var(--color-border)' : '#111827',
                color: msg.role === 'user' ? 'var(--color-text)' : '#fff',
              }"
            >
              {{ msg.role === "user" ? "JS" : "📑" }}
            </div>
            <div style="flex: 1; min-width: 0; max-width: calc(100% - 40px)">
              <!-- Tool-Call-Chips -->
              <div
                v-if="msg.tools && msg.tools.length > 0"
                class="flex flex-wrap"
                style="gap: 4px; margin-bottom: 6px"
              >
                <span v-for="tool in msg.tools" :key="tool" class="tool-chip">
                  ↳ {{ tool }}
                </span>
              </div>
              <!-- Bubble -->
              <div
                :class="['msg-bubble', msg.role === 'user' ? 'msg-user' : 'msg-assistant']"
              >
                <MarkdownRenderer v-if="msg.role === 'assistant'" :content="msg.text" />
                <span v-else>{{ msg.text }}</span>
              </div>
            </div>
          </div>

          <!-- Denkt nach… -->
          <div v-if="loading" class="flex" style="gap: 12px; align-items: flex-start">
            <div
              style="
                width: 28px;
                height: 28px;
                border-radius: 6px;
                background: #111827;
                color: #fff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                flex-shrink: 0;
              "
            >
              📑
            </div>
            <div class="msg-bubble msg-assistant" style="flex: 1; max-width: none">
              <div class="flex items-center" style="gap: 8px">
                <span class="chat-spinner" />
                <span v-if="toolCalls.length === 0" style="color: var(--color-text-muted)">
                  ● Denkt nach…
                </span>
                <div v-else class="flex flex-wrap" style="gap: 4px">
                  <span v-for="tool in toolCalls" :key="tool" class="tool-chip">
                    ↳ {{ tool }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Composer -->
      <div
        style="
          border-top: 1px solid var(--color-border-subtle);
          background: var(--color-bg);
          flex-shrink: 0;
        "
      >
        <div style="max-width: 760px; margin: 0 auto; padding: 16px 20px">
          <!-- Status-Pille bei Dateisuche -->
          <div
            v-if="searchMode"
            class="flex items-center"
            style="gap: 8px; font-size: 11px; color: var(--color-text-muted); margin-bottom: 8px"
          >
            <span
              class="flex items-center"
              style="
                gap: 6px;
                padding: 3px 10px;
                border: 1px solid var(--color-border);
                border-radius: 9999px;
                background: var(--color-bg-subtle);
              "
            >
              <BIcon name="search" :size="12" />
              Dateisuche aktiv
              <span v-if="projectFilter" class="font-mono" style="color: var(--color-text-tertiary)"
                >· {{ projectFilter }}</span
              >
              <button
                @click="searchMode = false; projectFilter = null"
                style="
                  background: transparent;
                  border: none;
                  color: var(--color-text-faint);
                  cursor: pointer;
                  padding: 0;
                  margin-left: 2px;
                "
              >
                <BIcon name="x" :size="10" />
              </button>
            </span>
          </div>

          <!-- Input-Box -->
          <div
            ref="attachMenuRef"
            style="
              position: relative;
              border: 1px solid var(--color-border);
              border-radius: 10px;
              padding: 8px 8px 6px;
              background: var(--color-bg);
            "
          >
            <textarea
              v-model="input"
              @keydown="onKeydown"
              :disabled="loading"
              placeholder="Nachricht eingeben…"
              rows="1"
              style="
                width: 100%;
                padding: 6px 8px;
                border: none;
                outline: none;
                font-size: 14px;
                resize: none;
                background: transparent;
                color: var(--color-text);
                font-family: inherit;
                min-height: 44px;
              "
            />
            <div class="flex items-center" style="gap: 4px; padding: 0 4px">
              <button @click="toggleAttachMenu" :disabled="loading" class="composer-icon" title="Werkzeuge">
                <BIcon name="plus" :size="14" />
              </button>
              <button class="composer-icon" disabled title="Anhang">
                <BIcon name="paperclip" :size="14" />
              </button>
              <button class="composer-icon" disabled title="Audio">
                <BIcon name="mic" :size="14" />
              </button>
              <div class="flex-1" />
              <span style="font-size: 10px; color: var(--color-text-tertiary); margin-right: 8px">
                <span class="kbd">⏎</span> senden · <span class="kbd">⇧⏎</span> neue Zeile
              </span>
              <button
                @click="send"
                :disabled="loading || !input.trim()"
                class="send-btn"
                aria-label="Senden"
              >
                <BIcon name="arrowRight" :size="14" :stroke-width="2" />
              </button>
            </div>

            <!-- Werkzeug-Popover -->
            <div
              v-if="showAttachMenu"
              style="
                position: absolute;
                bottom: 100%;
                left: 0;
                margin-bottom: 8px;
                width: 288px;
                background: var(--color-bg);
                border: 1px solid var(--color-border);
                border-radius: 10px;
                padding: 14px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
                z-index: 10;
              "
            >
              <label class="flex items-center" style="gap: 8px; cursor: pointer">
                <input type="checkbox" v-model="searchMode" />
                <span style="font-size: 13px; color: var(--color-text)">Dateisuche aktivieren</span>
              </label>
              <p
                style="
                  margin: 4px 0 0 24px;
                  font-size: 11px;
                  color: var(--color-text-tertiary);
                "
              >
                Der Assistent durchsucht deinen Workspace vor jeder Antwort.
              </p>
              <div
                v-if="searchMode"
                style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-subtle)"
              >
                <div class="eyebrow" style="margin-bottom: 4px">Projekt</div>
                <select
                  v-model="projectFilter"
                  style="
                    width: 100%;
                    padding: 6px 8px;
                    border: 1px solid var(--color-border);
                    border-radius: 6px;
                    font-size: 13px;
                    outline: none;
                    background: var(--color-bg);
                    color: var(--color-text);
                  "
                >
                  <option :value="null">Alle Projekte</option>
                  <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
                </select>
              </div>
            </div>
          </div>

          <p
            style="
              text-align: center;
              font-size: 10px;
              color: var(--color-text-tertiary);
              margin-top: 8px;
              margin-bottom: 0;
            "
          >
            Lokal gehostet · Antworten können Fehler enthalten.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 180ms ease;
}
.session-item:hover {
  background: var(--color-border-subtle);
  color: var(--color-text);
}
.session-item-active {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}
.session-del {
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  opacity: 0;
  padding: 2px;
  border-radius: 4px;
  transition: opacity 180ms ease;
}
.session-item:hover .session-del {
  opacity: 1;
}
.session-del:hover {
  color: var(--color-danger);
  background: var(--color-border-subtle);
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
}
.icon-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.msg-bubble {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.55;
  word-wrap: break-word;
}
.msg-user {
  background: var(--color-primary);
  color: var(--color-bg);
  border-bottom-right-radius: 2px;
  display: inline-block;
  max-width: 85%;
  margin-left: auto;
}
.msg-assistant {
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text);
  border-bottom-left-radius: 2px;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--color-border-subtle);
  color: var(--color-text-muted);
}

.chat-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-text-muted);
  border-radius: 9999px;
  animation: chat-spin 700ms linear infinite;
}
@keyframes chat-spin {
  to {
    transform: rotate(360deg);
  }
}

.composer-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
}
.composer-icon:hover {
  background: var(--color-border-subtle);
  color: var(--color-text);
}
.composer-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--color-primary);
  color: var(--color-bg);
  border: none;
  cursor: pointer;
  transition: opacity 180ms ease;
}
.send-btn:hover {
  opacity: 0.9;
}
.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
