import fs from "fs";
import path from "path";
import type OpenAI from "openai";
import { client, getModel } from "./client.js";
import { loadAgentWorkspace, finalizeMainWorkspace } from "../vault/index.js";

// ---- Setup State (replaces src/setup.ts) ----

let _active = false;

export function isSetupActive(): boolean { return _active; }
export function activateSetup(): void { _active = true; }
export function deactivateSetup(): void { _active = false; }

// ---- Bootstrap Prompt ----

function loadBootstrapPrompt(): string {
  const bootstrapPath = path.join(
    process.env.VAULT_PATH!,
    "Agents", "Main", "BOOTSTRAP.md"
  );
  if (fs.existsSync(bootstrapPath)) {
    return fs.readFileSync(bootstrapPath, "utf-8").trim();
  }
  return "Du bist ein Einrichtungsassistent. Frage nach Name, Emoji, Charakter, Unternehmenskontext, Benutzername und Unternehmensname. Dann rufe setup_abschliessen auf.";
}

// ---- Setup Tool ----

const SETUP_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "setup_abschliessen",
    description: "Schliesst die Ersteinrichtung ab und speichert alle Konfigurationen.",
    parameters: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Name des Assistenten" },
        emoji:       { type: "string", description: "Emoji des Assistenten" },
        vibe:        { type: "string", description: "Charakter/Vibe des Assistenten" },
        context:     { type: "string", description: "Beschreibung des Unternehmens" },
        userName:    { type: "string", description: "Name des Benutzers" },
        userCompany: { type: "string", description: "Name des Unternehmens" },
      },
      required: ["name", "emoji", "vibe", "context", "userName", "userCompany"],
    },
  },
};

// ---- Setup Conversation ----

let _setupMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

export async function processSetup(userMessage: string): Promise<string> {
  if (_setupMessages.length === 0) {
    _setupMessages = [{ role: "system", content: loadBootstrapPrompt() }];
  }

  _setupMessages.push({ role: "user", content: userMessage });

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: _setupMessages,
    tools: [SETUP_TOOL],
    tool_choice: "auto",
  });

  const reply = response.choices[0].message;
  _setupMessages.push(reply);

  if (reply.tool_calls?.length) {
    const call = reply.tool_calls[0] as { id: string; function: { name: string; arguments: string } };
    let args: { name: string; emoji: string; vibe: string; context: string; userName: string; userCompany: string };
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      return "Fehler beim Verarbeiten der Setup-Daten. Bitte versuche es erneut.";
    }

    finalizeMainWorkspace(args);
    deactivateSetup();
    _setupMessages = [];

    return `\u2705 Eingerichtet!\n\n${args.emoji} ${args.name}\n${args.vibe}\n\nHallo ${args.userName}! Ich bin bereit — was kann ich fuer ${args.userCompany} tun?`;
  }

  return reply.content ?? "...";
}
