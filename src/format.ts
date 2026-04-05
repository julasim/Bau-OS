/**
 * Konvertiert LLM-Markdown-Output zu Telegram HTML.
 * Telegram unterstützt: <b>, <i>, <u>, <s>, <code>, <pre>
 */
export function fmt(text: string): string {
  return text
    // HTML-Sonderzeichen escapen (ZUERST, vor den Ersetzungen)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // ```codeblock``` → <pre>
    .replace(/```[\w]*\n?([\s\S]+?)```/g, "<pre>$1</pre>")
    // `inline code` → <code>
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    // **fett** → <b>
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    // *kursiv* → <i>  (nur wenn nicht schon bold)
    .replace(/\*([^*\n]+?)\*/g, "<i>$1</i>")
    // __unterstrichen__ → <u>
    .replace(/__(.+?)__/gs, "<u>$1</u>")
    // _kursiv_ → <i>
    .replace(/_([^_\n]+?)_/g, "<i>$1</i>");
}
