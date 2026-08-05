#!/usr/bin/env tsx
// ============================================================
// PATIO — Re-Encrypt-Skript (SEC-4)
// Aufruf: npm run db:reencrypt          (schreibt)
//         npm run db:reencrypt -- --dry (nur Vorschau)
// ============================================================
// Schluesselt alle verschluesselten Felder auf den PRIMAERschluessel um
// (ENCRYPTION_KEY, sonst JWT_SECRET). Migriert:
//   - Legacy-Plaintext -> verschluesselt
//   - mit dem alten Schluessel (JWT_SECRET) verschluesselte Bestandsdaten
//     -> auf ENCRYPTION_KEY
// Bereits mit dem Primaerschluessel verschluesselte Werte werden uebersprungen
// (idempotent). Nicht entschluesselbare Werte werden NICHT angefasst — es wird
// nie null/kaputt zurueckgeschrieben.
//
// Ablauf (siehe docs/sec-4-crypto-migration.md):
//   1) ENCRYPTION_KEY in .env setzen, Stack mit --force-recreate hochziehen
//      (Code kennt dann beide Schluessel: neu = ENCRYPTION_KEY, alt = JWT_SECRET).
//   2) Dieses Skript laufen lassen (erst --dry, dann echt).
//   3) Stufe 2 (spaeter): Legacy-Plaintext- + JWT_SECRET-Fallback aus crypto.ts
//      entfernen.
// ============================================================

import "dotenv/config";
import { DB_ENABLED, ENCRYPTION_KEY_SET } from "../src/config.js";
import { getDb } from "../src/db/client.js";
import { closeDb } from "../src/db/index.js";
import { decryptString, encryptString, needsReencrypt } from "../src/api/crypto.js";

const DRY = process.argv.includes("--dry");

// Alle verschluesselten Felder (Tabelle, Primaerschluessel-Spalte, Feld).
const FIELDS: Array<{ table: string; idCol: string; col: string }> = [
  { table: "users", idCol: "id", col: "telegram_bot_token" },
  { table: "users", idCol: "id", col: "totp_secret_encrypted" },
  { table: "user_microsoft_accounts", idCol: "user_id", col: "access_token_encrypted" },
  { table: "user_microsoft_accounts", idCol: "user_id", col: "refresh_token_encrypted" },
];

if (!DB_ENABLED) {
  console.error("❌ DATABASE_URL nicht gesetzt in .env");
  process.exit(1);
}

if (!ENCRYPTION_KEY_SET) {
  console.warn(
    "⚠ ENCRYPTION_KEY ist nicht gesetzt — es wird weiter mit JWT_SECRET verschluesselt.\n" +
      "  Nur Legacy-Plaintext wird migriert. Setze ENCRYPTION_KEY, um auf einen\n" +
      "  eigenen Schluessel umzustellen (siehe docs/sec-4-crypto-migration.md).",
  );
}

const db = getDb();
let total = 0;
let migrated = 0;
let skipped = 0;
let failed = 0;
let overtaken = 0; // zwischenzeitlich von der App geaendert — nicht ueberschrieben

for (const f of FIELDS) {
  let rows: Array<{ id: unknown; val: unknown }>;
  try {
    rows = await db`
      SELECT ${db(f.idCol)} AS id, ${db(f.col)} AS val
      FROM ${db(f.table)}
      WHERE ${db(f.col)} IS NOT NULL
    `;
  } catch {
    console.warn(`  ⏭  ${f.table}.${f.col}: nicht abfragbar (Migration evtl. nicht angewandt) — uebersprungen.`);
    continue;
  }

  for (const row of rows) {
    total++;
    const val = String(row.val);
    // Die Query liefert id/val bewusst als `unknown` (der Spaltenname steht
    // erst zur Laufzeit fest). Fuer die WHERE-Klausel unten braucht
    // postgres.js einen konkreten Bind-Typ — die id-Spalten sind UUID oder
    // TEXT, String() ist dafuer verlustfrei.
    const rowId = String(row.id);
    if (!needsReencrypt(val)) {
      skipped++;
      continue;
    }
    const plain = decryptString(val);
    if (plain === null) {
      failed++;
      console.warn(`  ❗ ${f.table}.${f.col} ${f.idCol}=${rowId}: nicht entschluesselbar — uebersprungen (nichts geschrieben).`);
      continue;
    }
    const reenc = encryptString(plain);
    // Defensive Guard: encryptString gibt bei falsy Input null zurueck. Ein
    // null hier duerfte nach dem decrypt/needsReencrypt-Pfad nicht auftreten,
    // aber niemals null in die Spalte schreiben — das waere Datenverlust.
    if (reenc === null) {
      failed++;
      console.warn(`  ❗ ${f.table}.${f.col} ${f.idCol}=${rowId}: Re-Encryption ergab null — uebersprungen (nichts geschrieben).`);
      continue;
    }
    if (!DRY) {
      // Lost-Update-Schutz: nur schreiben, wenn der Alt-Wert unveraendert ist.
      // Hat die App den Wert zwischenzeitlich geaendert, trifft die WHERE-Klausel
      // keine Zeile (count === 0) — dann nichts ueberschreiben, sondern als
      // "geueberholt" zaehlen (kein Fehler).
      const result = await db`
        UPDATE ${db(f.table)} SET ${db(f.col)} = ${reenc}
         WHERE ${db(f.idCol)} = ${rowId} AND ${db(f.col)} = ${val}
      `;
      if (result.count === 0) {
        overtaken++;
        console.warn(`  ⏭  ${f.table}.${f.col} ${f.idCol}=${rowId}: zwischenzeitlich geaendert — uebersprungen (geueberholt).`);
        continue;
      }
    }
    migrated++;
    console.log(`  ${DRY ? "[dry] " : "✓ "}${f.table}.${f.col} ${f.idCol}=${rowId} umgeschluesselt.`);
  }
}

console.log(
  `\nFertig. gesamt=${total} umgeschluesselt=${migrated} schon-ok=${skipped} geueberholt=${overtaken} fehlgeschlagen=${failed}` +
    (DRY ? "  (DRY-RUN, nichts geschrieben)" : ""),
);

await closeDb();
// Exit 2 signalisiert dem Aufrufer, dass mindestens ein Wert nicht migriert
// werden konnte (manueller Blick noetig) — ohne den Rest zu blockieren.
if (failed > 0) process.exit(2);
