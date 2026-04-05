// ─── Setup-State ─────────────────────────────────────────────────────────────
// Einfaches Flag — die eigentliche Logik läuft in llm.ts (processSetup).

let _active = false;

export function isSetupActive(): boolean {
  return _active;
}

export function activateSetup(): void {
  _active = true;
}

export function deactivateSetup(): void {
  _active = false;
}
