<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

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
  await loadSessions();
  // Neueste Session oeffnen falls vorhanden
  if (sessions.value.length > 0) {
    await selectSession(sessions.value[0].id);
  }
});
</script>

<template>
  <div class="flex h-full">
    <!-- Sidebar -->
    <aside
      v-if="sidebarOpen"
      class="w-64 border-r border-gray-200 flex flex-col flex-shrink-0 bg-white"
    >
      <!-- New Chat Button -->
      <div class="p-3">
        <button
          @click="newChat"
          class="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded hover:bg-gray-50 transition"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Neuer Chat
        </button>
      </div>

      <!-- Sessions List -->
      <nav class="flex-1 overflow-y-auto px-2 pb-3">
        <div v-for="group in groupedSessions" :key="group.label" class="mb-3">
          <p class="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {{ group.label }}
          </p>
          <div
            v-for="session in group.items"
            :key="session.id"
            @click="selectSession(session.id)"
            :class="[
              'flex items-center gap-1 px-3 py-2 rounded text-sm cursor-pointer transition group',
              activeSessionId === session.id
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            ]"
          >
            <span class="flex-1 truncate" :title="session.lastMessage || session.title">
              {{ session.lastMessage || session.title }}
            </span>
            <button
              @click.stop="deleteSession(session.id)"
              class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition flex-shrink-0"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div v-if="sessions.length === 0" class="px-3 py-4 text-xs text-gray-400 text-center">
          Noch keine Chats
        </div>
      </nav>
    </aside>

    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Top Bar -->
      <div class="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100">
        <button
          @click="sidebarOpen = !sidebarOpen"
          class="p-1.5 rounded hover:bg-gray-100 transition text-gray-400 hover:text-gray-600"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="text-sm text-gray-500">Chat</span>
      </div>

      <!-- Messages -->
      <div ref="chatContainer" class="flex-1 overflow-y-auto">
        <div class="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div v-if="messages.length === 0 && !loading" class="text-center py-20">
            <p class="text-gray-400 text-sm">Starte ein Gespraech mit dem KI-Agenten.</p>
          </div>

          <div
            v-for="(msg, i) in messages"
            :key="i"
            :class="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
          >
            <div
              :class="[
                'max-w-[85%] rounded-lg px-4 py-3 text-sm',
                msg.role === 'user'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-50 border border-gray-100 text-gray-800',
              ]"
            >
              <div v-if="msg.tools && msg.tools.length > 0" class="flex flex-wrap gap-1 mb-2">
                <span
                  v-for="tool in msg.tools"
                  :key="tool"
                  class="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-gray-200 text-gray-500 rounded"
                >
                  {{ tool }}
                </span>
              </div>
              <div v-if="msg.role === 'assistant'">
                <MarkdownRenderer :content="msg.text" />
              </div>
              <span v-else>{{ msg.text }}</span>
            </div>
          </div>

          <!-- Loading -->
          <div v-if="loading" class="flex justify-start">
            <div class="bg-gray-50 border border-gray-100 rounded-lg px-4 py-3 text-sm text-gray-500">
              <div class="flex items-center gap-2">
                <span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full"></span>
                <span v-if="toolCalls.length === 0">Denkt nach...</span>
                <span v-else class="flex flex-wrap items-center gap-1">
                  <span
                    v-for="tool in toolCalls"
                    :key="tool"
                    class="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-gray-200 text-gray-500 rounded"
                  >
                    {{ tool }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="border-t border-gray-200 bg-white">
        <div class="max-w-3xl mx-auto px-4 py-3">
          <div class="flex gap-2">
            <textarea
              v-model="input"
              @keydown="onKeydown"
              :disabled="loading"
              placeholder="Nachricht eingeben..."
              rows="1"
              class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 outline-none disabled:opacity-50"
            />
            <button
              @click="send"
              :disabled="loading || !input.trim()"
              class="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
