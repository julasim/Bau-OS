#!/usr/bin/env tsx
// ============================================================
// PATIO — Einmal-Import: Datei-Ablage → Datenbank
//
// Liest eine alte, dateibasierte Ablage (Projekte/, Inbox/, data/*.json)
// und schreibt sie in die PostgreSQL-Datenbank. Gedacht fuer die
// Uebernahme gewachsener Bestaende — etwa aus der Zeit vor dem Umbau zum
// Firmenserver oder aus PATIO Desktop (apps/patio-app-lokal).
//
// Der laufende Betrieb braucht dieses Skript NICHT: seit AP0 gibt es
// keinen Filesystem-Modus mehr, alle Daten entstehen direkt in der DB.
//
// Aufruf: npx tsx scripts/migrate-vault-to-db.ts [ABLAGE-PFAD]
//         npm run db:import -- /pfad/zur/alten/ablage
//
// Ohne Argument wird WORKSPACE_PATH aus der .env genommen.
//
// WARUM DAS SKRIPT VORHER GAR NICHT LIEF:
// Es importierte `VAULT_PATH` aus src/config.ts — diesen Export gibt es
// nicht (der Schluessel heisst dort WORKSPACE_PATH). Node brach beim Start
// mit "does not provide an export named 'VAULT_PATH'" ab. Aufgefallen ist
// das nie, weil tsconfig.json nur src/**/* prueft und scripts/ damit weder
// von `tsc --noEmit` noch von der CI gesehen wird.
//
// Voraussetzungen:
//   - DATABASE_URL in .env gesetzt
//   - Migrationen bereits ausgefuehrt (npm run db:migrate)
//
// Der Import ist wiederholbar: bereits vorhandene Datensaetze werden
// anhand von Name/Text/Datum erkannt und uebersprungen.
// ============================================================

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DB_ENABLED, WORKSPACE_PATH } from "../src/config.js";
import { getDb, checkDbHealth, closeDb } from "../src/db/index.js";
import { PLATZHALTER_PRAEFIX } from "../src/data/projektnummer.js";

// ── Validierung ─────────────────────────────────────────────

if (!DB_ENABLED) {
  console.error("❌ DATABASE_URL nicht gesetzt in .env");
  process.exit(1);
}

// Erstes Argument schlaegt die .env — so laesst sich eine fremde Ablage
// importieren, ohne die Konfiguration des laufenden Dienstes zu aendern.
const SOURCE_PATH = process.argv[2] || WORKSPACE_PATH || "";

if (!SOURCE_PATH || !fs.existsSync(SOURCE_PATH)) {
  console.error("❌ Ablage-Pfad nicht angegeben oder nicht vorhanden:", SOURCE_PATH || "(leer)");
  console.error("   Aufruf: npm run db:import -- /pfad/zur/alten/ablage");
  console.error("   Alternativ WORKSPACE_PATH in der .env setzen.");
  process.exit(1);
}

// data/*.json (globale Aufgaben, Termine, Team) lagen frueher im
// Installationsverzeichnis, nicht in der Ablage. Zweites Argument erlaubt
// einen abweichenden Ort.
const DATA_DIR = process.argv[3] || path.join(process.cwd(), "data");

// ── Hilfsfunktionen ─────────────────────────────────────────

function readJsonSafe<T>(filepath: string): T | null {
  try {
    if (!fs.existsSync(filepath)) return null;
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    console.warn(`   ⚠️  JSON-Parse-Fehler: ${filepath}`);
    return null;
  }
}

function listDirs(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function listMdFiles(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

interface VaultTask {
  id: string;
  text: string;
  status: string;
  assignee?: string | null;
  date?: string | null;
  location?: string | null;
  project?: string | null;
  priority?: string;
  dueDate?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VaultTermin {
  id: string;
  text: string;
  datum: string;
  uhrzeit?: string | null;
  endzeit?: string | null;
  location?: string | null;
  assignees?: string[];
  project?: string | null;
  recurring?: string | null;
  color?: string | null;
  createdAt: string;
}

interface VaultTeamMember {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  company?: string;
}

// ── Hauptmigration ──────────────────────────────────────────

try {
  const db = getDb();
  const healthy = await checkDbHealth();
  if (!healthy) {
    console.error("❌ Datenbank nicht erreichbar");
    process.exit(1);
  }

  console.log("\n🔄 Datei-Ablage → Datenbank");
  console.log(`   Quelle:      ${SOURCE_PATH}`);
  console.log(`   data/*.json: ${DATA_DIR}`);
  console.log("");

  let totalProjects = 0;
  let totalTasks = 0;
  let totalTermine = 0;
  let totalNotes = 0;
  let totalTeam = 0;
  let skipped = 0;

  // ── 1. Projekte ─────────────────────────────────────────

  console.log("📁 Projekte migrieren...");
  const projektePath = path.join(SOURCE_PATH, "Projekte");
  const projectNames = listDirs(projektePath);
  const projectIds = new Map<string, string>();

  for (const name of projectNames) {
    // Pruefen ob Projekt bereits existiert
    const [existing] = await db`SELECT id FROM projects WHERE name = ${name}`;
    if (existing) {
      projectIds.set(name, String(existing.id));
      skipped++;
      continue;
    }

    const folderPath = path.join(projektePath, name);
    const id = crypto.randomUUID();
    // Die Projektnummer ist seit Migration 052 Pflicht und eindeutig. Aus dem
    // Vault laesst sie sich nicht ableiten — dort gibt es nur Ordnernamen.
    //
    // Deshalb derselbe Platzhalter, den auch 052 fuer Bestandsprojekte setzt:
    // erkennbar als „noch keine Nummer", eindeutig von Bauart, und in der
    // Oberflaeche als nachzutragen ausgewiesen. Eine erfundene Nummer waere
    // schlimmer als ein sichtbares Loch — sie saehe aus wie eine Aktennummer.
    //
    // Ohne diese Zeile bricht der Import nach 052 mit einem NOT-NULL-Fehler
    // ab. Dasselbe Skript ist schon einmal monatelang unbemerkt beim Start
    // gescheitert, deshalb steht die Begruendung hier und nicht im Commit.
    const platzhalter = `${PLATZHALTER_PRAEFIX}${id.slice(0, 8)}`;
    await db`
      INSERT INTO projects (id, name, folder_path, status, projektnummer)
      VALUES (${id}, ${name}, ${folderPath}, 'aktiv', ${platzhalter})
    `;
    projectIds.set(name, id);
    totalProjects++;
  }
  console.log(`   ✅ ${totalProjects} Projekte importiert${skipped > 0 ? `, ${skipped} uebersprungen` : ""}`);

  // ── 2. Tasks ────────────────────────────────────────────

  console.log("📋 Aufgaben migrieren...");
  skipped = 0;

  // Globale Tasks aus data/tasks.json
  const globalTasksPath = path.join(DATA_DIR, "tasks.json");
  const globalTasks = readJsonSafe<VaultTask[]>(globalTasksPath) || [];

  // Projekt-Tasks
  const allTasks: { task: VaultTask; projectName?: string }[] = globalTasks.map((t) => ({ task: t }));
  for (const projectName of projectNames) {
    const projectTasksPath = path.join(projektePath, projectName, "tasks.json");
    const tasks = readJsonSafe<VaultTask[]>(projectTasksPath) || [];
    for (const task of tasks) {
      allTasks.push({ task, projectName });
    }
  }

  for (const { task, projectName } of allTasks) {
    // Duplikat-Check ueber text + createdAt
    const [existing] = await db`SELECT id FROM tasks WHERE text = ${task.text} AND created_at = ${task.createdAt}`;
    if (existing) {
      skipped++;
      continue;
    }

    const projectId = projectName ? projectIds.get(projectName) ?? null : null;
    await db`
      INSERT INTO tasks (id, text, status, priority, assignee, date, due_date, location, project_id, completed_at, created_at, updated_at)
      VALUES (
        ${crypto.randomUUID()},
        ${task.text},
        ${task.status || "offen"},
        ${task.priority || "mittel"},
        ${task.assignee || null},
        ${task.date || null},
        ${task.dueDate ? task.dueDate : null},
        ${task.location || null},
        ${projectId},
        ${task.completedAt || null},
        ${task.createdAt},
        ${task.updatedAt}
      )
    `;
    totalTasks++;
  }
  console.log(`   ✅ ${totalTasks} Aufgaben importiert${skipped > 0 ? `, ${skipped} uebersprungen` : ""}`);

  // ── 3. Termine ──────────────────────────────────────────

  console.log("📅 Termine migrieren...");
  skipped = 0;

  const globalTerminePath = path.join(DATA_DIR, "termine.json");
  const globalTermine = readJsonSafe<VaultTermin[]>(globalTerminePath) || [];

  const allTermine: { termin: VaultTermin; projectName?: string }[] = globalTermine.map((t) => ({ termin: t }));
  for (const projectName of projectNames) {
    const projectTerminePath = path.join(projektePath, projectName, "termine.json");
    const termine = readJsonSafe<VaultTermin[]>(projectTerminePath) || [];
    for (const termin of termine) {
      allTermine.push({ termin, projectName });
    }
  }

  for (const { termin, projectName } of allTermine) {
    const [existing] = await db`SELECT id FROM termine WHERE text = ${termin.text} AND datum = ${termin.datum}`;
    if (existing) {
      skipped++;
      continue;
    }

    const projectId = projectName ? projectIds.get(projectName) ?? null : null;
    await db`
      INSERT INTO termine (id, text, datum, uhrzeit, endzeit, location, assignees, project_id, recurring, color, created_at)
      VALUES (
        ${crypto.randomUUID()},
        ${termin.text},
        ${termin.datum},
        ${termin.uhrzeit || null},
        ${termin.endzeit || null},
        ${termin.location || null},
        ${termin.assignees || []},
        ${projectId},
        ${termin.recurring || null},
        ${termin.color || null},
        ${termin.createdAt}
      )
    `;
    totalTermine++;
  }
  console.log(`   ✅ ${totalTermine} Termine importiert${skipped > 0 ? `, ${skipped} uebersprungen` : ""}`);

  // ── 4. Notizen ──────────────────────────────────────────

  console.log("📝 Notizen migrieren...");
  skipped = 0;

  // Inbox-Notizen
  const inboxPath = path.join(SOURCE_PATH, "Inbox");
  const inboxFiles = listMdFiles(inboxPath);
  const allNotes: { filepath: string; projectName?: string }[] = inboxFiles.map((f) => ({
    filepath: path.join(inboxPath, f),
  }));

  // Projekt-Notizen
  for (const projectName of projectNames) {
    const notizenDir = path.join(projektePath, projectName, "Notizen");
    const noteFiles = listMdFiles(notizenDir);
    for (const f of noteFiles) {
      allNotes.push({ filepath: path.join(notizenDir, f), projectName });
    }
  }

  for (const { filepath, projectName } of allNotes) {
    const filename = path.basename(filepath, ".md");
    const content = fs.readFileSync(filepath, "utf-8");
    const title = content.split("\n").find((l) => l.trim() && !l.startsWith("---"))?.replace(/^#+\s*/, "").slice(0, 100) || filename;

    // Duplikat-Check
    const [existing] = await db`SELECT id FROM notes WHERE title = ${title}`;
    if (existing) {
      skipped++;
      continue;
    }

    const projectId = projectName ? projectIds.get(projectName) ?? null : null;
    const stats = fs.statSync(filepath);

    await db`
      INSERT INTO notes (id, title, content, project_id, source, created_at, updated_at)
      VALUES (
        ${crypto.randomUUID()},
        ${title},
        ${content},
        ${projectId},
        'vault',
        ${stats.birthtime.toISOString()},
        ${stats.mtime.toISOString()}
      )
    `;
    totalNotes++;
  }
  console.log(`   ✅ ${totalNotes} Notizen importiert${skipped > 0 ? `, ${skipped} uebersprungen` : ""}`);

  // ── 5. Team ─────────────────────────────────────────────

  console.log("👥 Team migrieren...");
  skipped = 0;

  const teamPath = path.join(DATA_DIR, "team.json");
  const team = readJsonSafe<VaultTeamMember[]>(teamPath) || [];

  for (const member of team) {
    const [existing] = await db`SELECT id FROM team_members WHERE name = ${member.name}`;
    if (existing) {
      skipped++;
      continue;
    }

    await db`
      INSERT INTO team_members (id, name, role, email, phone, company)
      VALUES (
        ${crypto.randomUUID()},
        ${member.name},
        ${member.role || null},
        ${member.email || null},
        ${member.phone || null},
        ${member.company || null}
      )
    `;
    totalTeam++;
  }
  console.log(`   ✅ ${totalTeam} Team-Mitglieder importiert${skipped > 0 ? `, ${skipped} uebersprungen` : ""}`);

  // ── Zusammenfassung ─────────────────────────────────────

  const total = totalProjects + totalTasks + totalTermine + totalNotes + totalTeam;
  console.log(`\n✅ Migration abgeschlossen: ${total} Datensaetze importiert`);
  console.log(`   Projekte:  ${totalProjects}`);
  console.log(`   Aufgaben:  ${totalTasks}`);
  console.log(`   Termine:   ${totalTermine}`);
  console.log(`   Notizen:   ${totalNotes}`);
  console.log(`   Team:      ${totalTeam}`);
} catch (err) {
  console.error("\n❌ Migrationsfehler:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await closeDb();
}
