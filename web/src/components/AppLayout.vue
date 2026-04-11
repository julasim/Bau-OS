<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import NavSidebar from "./NavSidebar.vue";

const route = useRoute();
const isChat = computed(() => route.name === "chat");
</script>

<template>
  <div class="flex min-h-screen bg-white">
    <NavSidebar />
    <main :class="['flex-1 overflow-auto', isChat ? '' : 'px-8 py-6']">
      <div :class="isChat ? 'h-full' : 'max-w-5xl'">
        <router-view />
      </div>
    </main>
  </div>
</template>
