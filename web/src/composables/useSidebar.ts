import { ref, onMounted, onUnmounted } from "vue";

// Shared singleton-state, damit TopBar + NavSidebar denselben Zustand teilen.
const open = ref(true);

function onResize() {
  if (typeof window === "undefined") return;
  if (window.innerWidth >= 1024) {
    open.value = true;
  }
}

export function useSidebar() {
  function toggle() {
    open.value = !open.value;
  }
  function close() {
    open.value = false;
  }
  function openSidebar() {
    open.value = true;
  }

  onMounted(() => {
    if (typeof window !== "undefined") {
      open.value = window.innerWidth >= 1024;
      window.addEventListener("resize", onResize);
    }
  });
  onUnmounted(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onResize);
    }
  });

  return { open, toggle, close, openSidebar };
}
