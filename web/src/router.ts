import { createRouter, createWebHistory } from "vue-router";
import { isAuthenticated } from "./api";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    {
      path: "/",
      component: () => import("./components/AppLayout.vue"),
      children: [
        { path: "", name: "dashboard", component: () => import("./views/DashboardView.vue") },
        { path: "notes", name: "notes", component: () => import("./views/NotesView.vue") },
        { path: "notes/:name", name: "note-editor", component: () => import("./views/NoteEditorView.vue") },
        { path: "tasks", name: "tasks", component: () => import("./views/TasksView.vue") },
        { path: "calendar", name: "calendar", component: () => import("./views/CalendarView.vue") },
        // Backward-Compat: /termine leitet auf den zusammengefuehrten Kalender weiter
        { path: "termine", redirect: "/calendar" },
        { path: "projects", name: "projects", component: () => import("./views/ProjectsView.vue") },
        { path: "projects/:name", name: "project-detail", component: () => import("./views/ProjectDetailView.vue") },
        { path: "team", name: "team", component: () => import("./views/TeamView.vue") },
        { path: "team/:id", name: "team-detail", component: () => import("./views/TeamDetailView.vue") },
        { path: "agents", name: "agents", component: () => import("./views/AgentsView.vue") },
        { path: "agents/:name/:filename", name: "agent-editor", component: () => import("./views/AgentEditorView.vue") },
        { path: "search", name: "search", component: () => import("./views/SearchView.vue") },
        { path: "files", name: "files", component: () => import("./views/FileBrowserView.vue") },
        { path: "chat", name: "chat", component: () => import("./views/ChatView.vue") },
        { path: "settings", name: "settings", component: () => import("./views/SettingsView.vue") },
      ],
    },
  ],
});

router.beforeEach((to) => {
  if (to.name !== "login" && !isAuthenticated()) {
    return { name: "login" };
  }
});

export { router };
