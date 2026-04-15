<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import NavSidebar from "./NavSidebar.vue";

const route = useRoute();
const isChat = computed(() => route.name === "chat");
</script>

<template>
  <div class="flex h-screen bg-white dark:bg-zinc-950 text-gray-900 dark:text-zinc-100 overflow-hidden">
    <NavSidebar />
    <main :class="['flex-1 min-w-0', isChat ? 'overflow-hidden' : 'overflow-auto px-8 py-6']">
      <div :class="isChat ? 'h-full' : 'max-w-5xl'">
        <router-view />
      </div>
    </main>
  </div>
</template>
