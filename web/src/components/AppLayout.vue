<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import NavSidebar from "./NavSidebar.vue";
import SystemStatusBanner from "./SystemStatusBanner.vue";
import TopBar from "./TopBar.vue";

const route = useRoute();
const isChat = computed(() => route.name === "chat");
</script>

<template>
  <div
    class="flex h-screen overflow-hidden"
    style="background: var(--color-bg); color: var(--color-text)"
  >
    <NavSidebar />
    <main class="flex-1 min-w-0 flex flex-col">
      <TopBar />
      <SystemStatusBanner />
      <div
        :class="[
          'flex-1 min-h-0',
          isChat ? 'overflow-hidden' : 'overflow-auto',
        ]"
      >
        <div :class="isChat ? 'h-full' : ''">
          <router-view />
        </div>
      </div>
    </main>
  </div>
</template>
