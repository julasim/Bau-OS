import { client, getModel } from "./client.js";
import { shouldCompact, getLogForCompaction, writeCompactedLog } from "../workspace/index.js";
import { logInfo, logError } from "../logger.js";

// Fehlgeschlagene Compactions pro Agent zählen — nach 3x Pause bis Neustart
const _compactionFailures = new Map<string, number>();
const MAX_COMPACTION_RETRIES = 3;

export async function runCompaction(agentName: string): Promise<void> {
  const failures = _compactionFailures.get(agentName) ?? 0;
  if (failures >= MAX_COMPACTION_RETRIES) return; // Zu oft fehlgeschlagen, ueberspringen

  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return;
  logInfo(`[${agentName}] Compaction gestartet`);

  try {
    const response = await client.chat.completions.create({
      model: getModel(),
      messages: [
        {
          role: "user",
          content: `Fasse diese Gespraechseintraege in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
        },
      ],
    });

    const summary = response.choices[0].message.content ?? "";
    if (summary) {
      writeCompactedLog(agentName, summary);
      _compactionFailures.delete(agentName); // Erfolg → Zaehler reset
      logInfo(`[${agentName}] Compaction abgeschlossen`);
    }
  } catch (err) {
    _compactionFailures.set(agentName, failures + 1);
    logError(`[${agentName}] Compaction fehlgeschlagen (${failures + 1}/${MAX_COMPACTION_RETRIES})`, err);
  }
}

export async function compactNow(agentName: string): Promise<string> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return "Tageslog ist noch klein – kein Komprimieren noetig.";

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [
      {
        role: "user",
        content: `Fasse diese Gespraechseintraege in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
      },
    ],
  });

  const summary = response.choices[0].message.content ?? "";
  if (!summary) return "Zusammenfassung fehlgeschlagen.";

  writeCompactedLog(agentName, summary);
  return `\u2705 Log komprimiert.\n\nZusammenfassung:\n${summary}`;
}
