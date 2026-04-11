<script setup lang="ts">
import NavSidebar from "./NavSidebar.vue";
</script>

<template>
  <div class="flex min-h-screen bg-white">
    <NavSidebar />
    <main class="flex-1 px-8 py-6 overflow-auto">
      <div class="max-w-5xl">
        <router-view />
      </div>
    </main>
  </div>
</template>
