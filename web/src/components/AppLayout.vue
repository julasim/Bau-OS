<script setup lang="ts">
import NavSidebar from "./NavSidebar.vue";
</script>

<template>
  <div class="flex min-h-screen">
    <NavSidebar />
    <main class="flex-1 p-6 bg-gray-50 overflow-auto">
      <router-view />
    </main>
  </div>
</template>
