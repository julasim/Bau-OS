#!/usr/bin/env tsx
// ============================================================
// PATIO — Datenbank-Migrations CLI
// Aufruf: npm run db:migrate         (Migrations ausfuehren)
//         npm run db:status          (Status anzeigen)
// ============================================================

import "dotenv/config";
import { DB_ENABLED } from "../src/config.js";
import { runMigrations, migrationStatus, checkDbHealth, closeDb } from "../src/db/index.js";

const command = process.argv[2] || "migrate";

if (!DB_ENABLED) {
  console.error("❌ DATABASE_URL nicht gesetzt in .env");
  console.error("   Setze z.B.: DATABASE_URL=postgres://patio:password@localhost:5432/patio");
  process.exit(1);
}

try {
  if (command === "status") {
    // ── Status anzeigen ──────────────────────────────────────
    const healthy = await checkDbHealth();
    console.log(`\n📊 Datenbank-Status:`);
    console.log(`   Verbindung:  ${healthy ? "✅ OK" : "❌ Nicht erreichbar"}`);

    if (healthy) {
      // Die frueher hier ausgegebene pgvector-Zeile ist entfallen: PATIO kennt
      // seit AP0 keine Embeddings mehr, das Schema legt keine Vektor-Objekte
      // an und beide compose-Dateien laufen auf einem gewoehnlichen
      // postgres:16. "❌ Nicht installiert" haette also den Sollzustand als
      // Mangel gemeldet.
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

    // Die pgvector-Warnung ist entfallen. Sie erschien nach dem Umbau auf
    // postgres:16 nach JEDEM erfolgreichen Lauf und riet zu einem Befehl
    // (CREATE EXTENSION vector), der dort gar nicht ausfuehrbar ist.
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
