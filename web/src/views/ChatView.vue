<script setup lang="ts">
import { ref, nextTick, onMounted } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
}

const messages = ref<ChatMessage[]>([]);
const input = ref("");
const loading = ref(false);
const toolCalls = ref<string[]>([]);
const chatContainer = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

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
      body: JSON.stringify({ message: text }),
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
        if (line.startsWith("event: ")) {
          const eventType = line.slice(7).trim();
          // Next line should be data
          continue;
        }
        if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          try {
            const data = JSON.parse(raw);

            if (data.status) {
              // thinking status — ignore, loading spinner handles this
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
            // Skip unparseable lines
          }
        }
      }
    }
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

onMounted(async () => {
  try {
    const history = await api.get<{ user: string; assistant: string }[]>("/chat/history");
    for (const entry of history) {
      messages.value.push({ role: "user", text: entry.user });
      messages.value.push({ role: "assistant", text: entry.assistant });
    }
    scrollToBottom();
  } catch {
    // Verlauf nicht verfuegbar — leerer Chat
  }
});
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-2rem)]">
    <h2 class="text-lg font-semibold mb-4">Chat</h2>

    <!-- Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto space-y-4 pb-4">
      <div v-if="messages.length === 0" class="text-gray-400 text-sm py-12 text-center">
        Starte ein Gespraech mit dem KI-Agenten.
      </div>

      <div v-for="(msg, i) in messages" :key="i" :class="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
        <div
          :class="[
            'max-w-[75%] rounded px-4 py-3 text-sm',
            msg.role === 'user'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-50 border border-gray-100 text-gray-800',
          ]"
        >
          <!-- Tool-Calls Badge -->
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

      <!-- Loading indicator -->
      <div v-if="loading" class="flex justify-start">
        <div class="bg-gray-50 border border-gray-100 rounded px-4 py-3 text-sm text-gray-500">
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

    <!-- Input -->
    <div class="border-t border-gray-200 pt-3">
      <div class="flex gap-2">
        <textarea
          v-model="input"
          @keydown="onKeydown"
          :disabled="loading"
          placeholder="Nachricht eingeben..."
          rows="1"
          class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm resize-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 outline-none disabled:opacity-50"
        />
        <button
          @click="send"
          :disabled="loading || !input.trim()"
          class="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition"
        >
          Senden
        </button>
      </div>
    </div>
  </div>
</template>
