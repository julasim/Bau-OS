#!/usr/bin/env tsx
// ============================================================
// Bau-OS — Datenbank-Migrations CLI
// Aufruf: npm run db:migrate         (Migrations ausfuehren)
//         npm run db:status          (Status anzeigen)
// ============================================================

import "dotenv/config";
import { DB_ENABLED } from "../src/config.js";
import { runMigrations, migrationStatus, checkDbHealth, checkPgVector, closeDb } from "../src/db/index.js";

const command = process.argv[2] || "migrate";

if (!DB_ENABLED) {
  console.error("❌ DATABASE_URL nicht gesetzt in .env");
  console.error("   Setze z.B.: DATABASE_URL=postgres://bauos:password@localhost:5432/bauos");
  process.exit(1);
}

try {
  if (command === "status") {
    // ── Status anzeigen ──────────────────────────────────────
    const healthy = await checkDbHealth();
    console.log(`\n📊 Datenbank-Status:`);
    console.log(`   Verbindung:  ${healthy ? "✅ OK" : "❌ Nicht erreichbar"}`);

    if (healthy) {
      const hasVector = await checkPgVector();
      console.log(`   pgvector:    ${hasVector ? "✅ Installiert" : "❌ Nicht installiert"}`);

      const status = await migrationStatus();
      console.log(`\n📋 Migrations:`);
      for (const m of status) {
        const icon = m.applied ? "✅" : "⏳";
        const date = m.appliedAt ? ` (${new Date(m.appliedAt).toLocaleString("de-AT")})` : "";
        console.log(`   ${icon} ${m.name}${date}`);
      }
      if (status.length === 0) {
        console.log("   Keine Migrations gefunden");
      }
    }
  } else if (command === "migrate") {
    // ── Migrations ausfuehren ────────────────────────────────
    console.log("\n🔄 Fuehre Migrations aus...\n");
    const count = await runMigrations();

    if (count > 0) {
      console.log(`\n✅ ${count} Migration(s) erfolgreich angewandt`);
    } else {
      console.log("\n✅ Datenbank ist auf dem neuesten Stand");
    }

    // pgvector pruefen
    const hasVector = await checkPgVector();
    if (!hasVector) {
      console.warn("\n⚠️  pgvector Extension nicht gefunden!");
      console.warn("   Fuehre aus: CREATE EXTENSION IF NOT EXISTS vector;");
    }
  } else {
    console.error(`Unbekannter Befehl: ${command}`);
    console.error("Verfuegbar: migrate, status");
    process.exit(1);
  }
} catch (err) {
  console.error("\n❌ Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await closeDb();
}
