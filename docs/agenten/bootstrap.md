# BOOTSTRAP.md

> Ersteinrichtungs-Wizard — wird nur beim allerersten Gespräch geladen.

## Was macht diese Datei?

`BOOTSTRAP.md` steuert den **Setup-Wizard**, der beim allerersten Start eines Agenten läuft. Sie wird **nur geladen wenn noch keine `MEMORY_LOGS/` existieren** (oder das Verzeichnis leer ist). Nach dem ersten Gespräch wird die Datei automatisch gelöscht.

Der Wizard sammelt über eine Konversation 6 Informationen und ruft dann das spezielle Tool `setup_abschliessen` auf, das die Workspace-Dateien (`IDENTITY.md`, `SOUL.md`, `USER.md`) automatisch generiert.

## Beispiel

```markdown
# Bauleiter-Bot – Bootstrap

Du bist ein Einrichtungsassistent. Stelle nacheinander diese 6 Fragen
(eine nach der anderen, warte jeweils auf die Antwort):

1. Wie soll ich heißen? (Name des Assistenten)
2. Welches Emoji passt zu mir?
3. Wie soll mein Charakter sein? (z.B. "direkt und pragmatisch")
4. Was macht dein Unternehmen? (kurze Beschreibung)
5. Wie heißt du? (Benutzername)
6. Wie heißt dein Unternehmen?

Wenn alle 6 Fragen beantwortet sind, rufe `setup_abschliessen` auf mit:
- name: Antwort auf Frage 1
- emoji: Antwort auf Frage 2
- vibe: Antwort auf Frage 3
- context: Antwort auf Frage 4
- userName: Antwort auf Frage 5
- userCompany: Antwort auf Frage 6

Sei freundlich und kurz. Stelle jeweils nur EINE Frage.
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Fragen ändern** | Der Setup-Wizard stellt andere Fragen. |
| **Fragen hinzufügen** | Mehr Information wird gesammelt — aber `setup_abschliessen` akzeptiert nur die 6 Standard-Felder. |
| **Ton ändern** | Der Wizard kommuniziert anders (z.B. formeller oder lockerer). |
| **Datei löschen vor dem ersten Gespräch** | Fallback-Prompt wird verwendet — der Wizard funktioniert trotzdem, aber mit generischem Text. |
| **Datei manuell neu anlegen nach Setup** | Wird ignoriert — Bootstrap wird nur geladen wenn `MEMORY_LOGS/` leer ist. |

## Ablauf des Setup-Wizards

```
Erster Start
    │
    ▼
MEMORY_LOGS/ existiert nicht oder ist leer?
    │ Ja
    ▼
BOOTSTRAP.md wird geladen
    │
    ▼
Agent stellt 6 Fragen (Name, Emoji, Vibe, Kontext, User, Firma)
    │
    ▼
Agent ruft setup_abschliessen auf
    │
    ▼
System generiert IDENTITY.md, SOUL.md, USER.md
    │
    ▼
BOOTSTRAP.md wird automatisch gelöscht
    │
    ▼
Normaler Betrieb
```

## Tipps

- **Einmal weg, für immer weg.** Nach dem ersten Gespräch wird `BOOTSTRAP.md` gelöscht. Um den Wizard erneut auszuloesen, müsstest du die Datei neu anlegen _und_ den `MEMORY_LOGS/`-Ordner leeren.
- **Anpassbar pro Agent.** Wenn du per `agent_erstellen` einen neuen Sub-Agenten anlegst, bekommt er eine eigene (minimale) `BOOTSTRAP.md`.
- **Die 6 Felder sind fix.** Das Tool `setup_abschliessen` erwartet genau diese 6 Parameter. Wenn du andere Informationen brauchst, sammle sie im Wizard und speichere sie manuell.
- **Fallback existiert.** Wenn keine `BOOTSTRAP.md` vorhanden ist, nutzt das System einen eingebauten Standard-Prompt. Der Wizard funktioniert immer — die Datei macht ihn nur anpassbar.

::: info Hinweis
`BOOTSTRAP.md` ist die einzige Workspace-Datei die automatisch gelöscht wird. Alle anderen Dateien bleiben dauerhaft bestehen.
:::
