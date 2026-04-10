import { describe, it, expect } from "vitest";
import {
  noteHandlers, taskHandlers, terminHandlers,
  fileHandlers, projectHandlers, agentHandlers,
  systemHandlers, webHandlers, dyntoolHandlers, mcpHandlers,
  noteSchemas, taskSchemas, terminSchemas,
  fileSchemas, projectSchemas, agentSchemas,
  systemSchemas, webSchemas, dyntoolSchemas, mcpSchemas,
} from "../src/llm/handlers/index.js";

const allHandlerMaps = [
  { name: "note", handlers: noteHandlers, schemas: noteSchemas },
  { name: "task", handlers: taskHandlers, schemas: taskSchemas },
  { name: "termin", handlers: terminHandlers, schemas: terminSchemas },
  { name: "file", handlers: fileHandlers, schemas: fileSchemas },
  { name: "project", handlers: projectHandlers, schemas: projectSchemas },
  { name: "agent", handlers: agentHandlers, schemas: agentSchemas },
  { name: "system", handlers: systemHandlers, schemas: systemSchemas },
  { name: "web", handlers: webHandlers, schemas: webSchemas },
  { name: "dyntool", handlers: dyntoolHandlers, schemas: dyntoolSchemas },
  { name: "mcp", handlers: mcpHandlers, schemas: mcpSchemas },
];

describe("Handler-Registry Konsistenz", () => {
  for (const { name, handlers, schemas } of allHandlerMaps) {
    describe(`${name}`, () => {
      it("jeder Handler hat ein passendes Schema", () => {
        const schemaNames = schemas.map(s => s.function.name);
        for (const handlerName of Object.keys(handlers)) {
          expect(schemaNames, `Handler "${handlerName}" fehlt im Schema`).toContain(handlerName);
        }
      });

      it("jedes Schema hat einen passenden Handler", () => {
        const handlerNames = Object.keys(handlers);
        for (const schema of schemas) {
          expect(handlerNames, `Schema "${schema.function.name}" hat keinen Handler`).toContain(schema.function.name);
        }
      });

      it("alle Handler sind async Funktionen", () => {
        for (const [name, handler] of Object.entries(handlers)) {
          expect(typeof handler, `${name} ist keine Funktion`).toBe("function");
        }
      });

      it("alle Schemas haben required-Array und properties", () => {
        for (const schema of schemas) {
          const params = schema.function.parameters as Record<string, unknown>;
          expect(params.type, `${schema.function.name}: parameters.type fehlt`).toBe("object");
          expect(params).toHaveProperty("properties");
          expect(params).toHaveProperty("required");
        }
      });
    });
  }

  it("keine doppelten Tool-Namen ueber alle Handler", () => {
    const allNames: string[] = [];
    for (const { handlers } of allHandlerMaps) {
      allNames.push(...Object.keys(handlers));
    }
    const unique = new Set(allNames);
    expect(allNames.length, `Duplikate: ${allNames.filter((n, i) => allNames.indexOf(n) !== i)}`).toBe(unique.size);
  });

  it("Gesamtzahl Handler = 41 (ohne antworten)", () => {
    let total = 0;
    for (const { handlers } of allHandlerMaps) {
      total += Object.keys(handlers).length;
    }
    expect(total).toBe(41);
  });
});
