// Persistiert Heartbeat-Praeferenzen pro chatId in data/heartbeat-prefs.json
// Format: { "chatIds": [123, 456] } — nur die aktivierten chatIds

import fs from "fs";
import path from "path";

const PREFS_FILE = path.join(process.cwd(), "data", "heartbeat-prefs.json");

type PrefsFile = { chatIds: number[] };

function loadPrefs(): PrefsFile {
  try {
    if (!fs.existsSync(PREFS_FILE)) return { chatIds: [] };
    return JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8")) as PrefsFile;
  } catch {
    return { chatIds: [] };
  }
}

function savePrefs(prefs: PrefsFile): void {
  fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

export function isHeartbeatEnabled(chatId: number): boolean {
  return loadPrefs().chatIds.includes(chatId);
}

export function setHeartbeatEnabled(chatId: number, enabled: boolean): void {
  const prefs = loadPrefs();
  if (enabled) {
    if (!prefs.chatIds.includes(chatId)) {
      prefs.chatIds.push(chatId);
    }
  } else {
    prefs.chatIds = prefs.chatIds.filter((id) => id !== chatId);
  }
  savePrefs(prefs);
}

// Gibt alle chatIds zurueck die Heartbeat aktiviert haben
export function getHeartbeatChatIds(): number[] {
  return loadPrefs().chatIds;
}

// Backward-compat: registriert eine chatId beim ersten Bot-Kontakt wenn noch nicht in Prefs
// (Opt-in by default fuer bestehende User)
export function ensureRegistered(chatId: number): void {
  const prefs = loadPrefs();
  if (!prefs.chatIds.includes(chatId)) {
    prefs.chatIds.push(chatId);
    savePrefs(prefs);
  }
}
