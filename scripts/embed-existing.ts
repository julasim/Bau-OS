#!/usr/bin/env tsx
// ============================================================
// Bau-OS — Batch-Embedding CLI
// Generiert Embeddings fuer alle Notizen/Dateien in der DB
// die noch keinen Vektor haben.
//
// Aufruf: npm run db:embed
//         npx tsx scripts/embed-existing.ts
// ============================================================

import "dotenv/config";
import { DB_ENABLED, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "../src/config.js";
import { checkDbHealth, checkPgVector, embedAllNotes, embedAllFiles, embeddingStats, closeDb } from "../src/db/index.js";

if (!DB_ENABLED) {
  console.error("❌ DATABASE_URL nicht gesetzt in .env");
  process.exit(1);
}

try {
  // Verbindung pruefen
  const healthy = await checkDbHealth();
  if (!healthy) {
    console.error("❌ Datenbank nicht erreichbar");
    process.exit(1);
  }

  const hasVector = await checkPgVector();
  if (!hasVector) {
    console.error("❌ pgvector Extension nicht installiert");
    process.exit(1);
  }

  console.log("\n🧠 Bau-OS Embedding-Pipeline");
  console.log(`   Modell:     ${EMBEDDING_MODEL}`);
  console.log(`   Dimensionen: ${EMBEDDING_DIMENSIONS}`);

  // Vorher-Statistik
  const before = await embeddingStats();
  console.log(`\n📊 Aktueller Stand:`);
  console.log(`   Notizen: ${before.notes.embedded}/${before.notes.total} embedded`);
  console.log(`   Dateien: ${before.files.embedded}/${before.files.total} embedded`);

  if (before.notes.embedded === before.notes.total && before.files.embedded === before.files.total) {
    console.log("\n✅ Alle Inhalte sind bereits embedded");
    process.exit(0);
  }

  // Notizen embedden
  const startNotes = Date.now();
  console.log("\n📝 Notizen embedden...");
  const noteCount = await embedAllNotes();
  const noteDuration = ((Date.now() - startNotes) / 1000).toFixed(1);
  console.log(`   ✅ ${noteCount} Notizen in ${noteDuration}s`);

  // Dateien embedden
  const startFiles = Date.now();
  console.log("\n📄 Dateien embedden...");
  const fileCount = await embedAllFiles();
  const fileDuration = ((Date.now() - startFiles) / 1000).toFixed(1);
  console.log(`   ✅ ${fileCount} Dateien in ${fileDuration}s`);

  // Nachher-Statistik
  const after = await embeddingStats();
  console.log(`\n📊 Ergebnis:`);
  console.log(`   Notizen: ${after.notes.embedded}/${after.notes.total} embedded`);
  console.log(`   Dateien: ${after.files.embedded}/${after.files.total} embedded`);
  console.log(`\n✅ Fertig: ${noteCount + fileCount} neue Embeddings generiert`);
} catch (err) {
  console.error("\n❌ Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await closeDb();
}
