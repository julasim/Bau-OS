import { createRouter, createWebHistory } from "vue-router";
import { isAuthenticated } from "./api";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    { path: "/setup", name: "setup", component: () => import("./views/SetupView.vue") },
    {
      path: "/",
      component: () => import("./components/AppLayout.vue"),
      children: [
        { path: "", name: "dashboard", component: () => import("./views/DashboardView.vue") },
        // Workspace v2: Notes als Master-Detail-Pattern. Eine Route mit
        // optionalem :name?-Param liefert sowohl /notes (Empty-State im
        // DetailPane) als auch /notes/:name (Editor). ListPane bleibt
        // immer gleich — User hat den Notiz-Index immer im Blick.
        {
          path: "notes/:name?",
          name: "notes",
          components: {
            listpane: () => import("./views/notes-v2/NotesListPane.vue"),
            default: () => import("./views/notes-v2/NoteDetail.vue"),
          },
        },
        // Backward-Compat: alte note-editor-Route leitet auf neue Master-Detail.
        { path: "notes-old/:name", redirect: (to) => `/notes/${to.params.name}` },
        // Workspace v2: Tasks Master/Detail mit Tabs (Offen/Aktiv/Erledigt/Alle).
        {
          path: "tasks/:id?",
          name: "tasks",
          components: {
            listpane: () => import("./views/tasks-v2/TasksListPane.vue"),
            default: () => import("./views/tasks-v2/TaskDetail.vue"),
          },
        },
        { path: "calendar", name: "calendar", component: () => import("./views/CalendarView.vue") },
        // Backward-Compat: /termine leitet auf den zusammengefuehrten Kalender weiter
        { path: "termine", redirect: "/calendar" },
        // Projektübersicht: vollbild Karten-/Tabellen-Ansicht (Design System v2).
        {
          path: "projects",
          name: "projects",
          component: () => import("./views/projects-v2/ProjectsOverviewView.vue"),
        },
        { path: "portfolio", name: "portfolio", component: () => import("./views/portfolio/PortfolioView.vue") },
        // Projekt-Detail: vollbreit (Referenz-Design) — keine ListPane,
        // Navigation über Breadcrumb "Projekte › Name".
        {
          path: "projects/:name",
          name: "project-detail",
          component: () => import("./views/projects-v2/ProjectDetailHost.vue"),
        },
        // Workspace v2: Team Master/Detail. ListPane mit Filter nach
        // Kategorie (Intern/Planer/...). Detail wrappt TeamDetailView.
        {
          path: "team/:id?",
          name: "team",
          components: {
            listpane: () => import("./views/team-v2/TeamListPane.vue"),
            default: () => import("./views/team-v2/TeamDetailHost.vue"),
          },
        },
        { path: "search", name: "search", component: () => import("./views/SearchView.vue") },
        { path: "files", name: "files", component: () => import("./views/FileBrowserView.vue") },
        { path: "settings", name: "settings", component: () => import("./views/SettingsView.vue") },
        { path: "admin/users", name: "admin-users", component: () => import("./views/AdminUsersView.vue") },
        { path: "firmen", name: "firmen", component: () => import("./views/FirmenView.vue") },
        { path: "aktivitaet", name: "aktivitaet", component: () => import("./views/AktivitaetView.vue") },
        { path: "admin/audit", name: "admin-audit", component: () => import("./views/AdminAuditView.vue") },
        {
          path: "admin/sicherung",
          name: "admin-sicherung",
          component: () => import("./views/AdminSicherungView.vue"),
        },
        { path: "papierkorb", name: "papierkorb", component: () => import("./views/PapierkorbView.vue") },
      ],
    },
    // Auffangnetz fuer unbekannte Pfade. Ohne diese Route rendert der Router
    // gar nichts und der Nutzer sieht eine weisse Seite ohne jeden Hinweis —
    // ein Tippfehler in der Adresse sah dann aus wie ein kaputtes Programm.
    // Aktuell betrifft das vor allem alte /docs-Lesezeichen: die Seite ist mit
    // dem Umbau zum Firmenserver entfallen.
    { path: "/:pfad(.*)*", redirect: { name: "dashboard" } },
  ],
});

router.beforeEach((to) => {
  // /login und /setup sind die einzigen oeffentlichen Routes — alles andere
  // braucht ein gueltiges JWT.
  const publicRoutes = new Set(["login", "setup"]);
  if (!publicRoutes.has(String(to.name)) && !isAuthenticated()) {
    return { name: "login" };
  }
});

export { router };
