// ============================================================
// PATIO — Clipboard-Utility
// ============================================================
// Wraps navigator.clipboard mit einem Fallback fuer Setups, in denen
// die moderne API nicht verfuegbar ist:
//   - HTTP-Verbindungen (kein "secure context" → navigator.clipboard
//     ist undefined). Beispiel: lokales PATIO via http://IP:8080
//     ohne TLS.
//   - Aeltere Browser ohne Clipboard-API.
//   - User hat Permission verweigert.
//
// Fallback: document.execCommand("copy") via temporaere <textarea>.
// Deprecated aber funktioniert auch auf HTTP zuverlaessig.
//
// Liefert true bei Erfolg, false sonst — Caller zeigt entsprechend
// Feedback. KEIN stilles Schlucken von Fehlern.
// ============================================================

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1) Moderner Pfad — nur in Secure Context (HTTPS oder localhost)
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission-Denied o.ae. → Fallback versuchen
    }
  }

  // 2) Fallback — temporaere textarea, selektieren, execCommand
  // execCommand ist zwar deprecated, funktioniert aber auf HTTP-Setups
  // wo navigator.clipboard nicht verfuegbar ist.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Off-screen platzieren damit Layout nicht ruckelt; readonly
    // verhindert dass mobile Tastatur aufpoppt.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS-quirk
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
