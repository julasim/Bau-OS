import { client, getModel } from "./client.js";
import { shouldCompact, getLogForCompaction, writeCompactedLog } from "../vault/index.js";
import { logInfo, logError } from "../logger.js";

export async function runCompaction(agentName: string): Promise<void> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return;
  logInfo(`[${agentName}] Compaction gestartet`);

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [{
      role: "user",
      content: `Fasse diese Gespraechseintraege in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
    }],
  });

  const summary = response.choices[0].message.content ?? "";
  if (summary) {
    writeCompactedLog(agentName, summary);
    logInfo(`[${agentName}] Compaction abgeschlossen`);
  }
}

export async function compactNow(agentName: string): Promise<string> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return "Tageslog ist noch klein – kein Komprimieren noetig.";

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [{
      role: "user",
      content: `Fasse diese Gespraechseintraege in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
    }],
  });

  const summary = response.choices[0].message.content ?? "";
  if (!summary) return "Zusammenfassung fehlgeschlagen.";

  writeCompactedLog(agentName, summary);
  return `\u2705 Log komprimiert.\n\nZusammenfassung:\n${summary}`;
}
