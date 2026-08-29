# Datenisolation

Zwei Ebenen: die Trennung **zwischen Büros** und die Trennung **innerhalb
eines Büros**.

## Zwischen Büros: eine Installation je Haus

Es gibt keine gemeinsam genutzte Infrastruktur. Jedes Büro betreibt PATIO auf
eigener Hardware im eigenen Netz.

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│  Büro A                      │   │  Büro B                      │
│                              │   │                              │
│  ┌────────────────────────┐  │   │  ┌────────────────────────┐  │
│  │ Reverse-Proxy (TLS)    │  │   │  │ Reverse-Proxy (TLS)    │  │
│  └───────────┬────────────┘  │   │  └───────────┬────────────┘  │
│  ┌───────────▼────────────┐  │   │  ┌───────────▼────────────┐  │
│  │ PATIO-Anwendung        │  │   │  │ PATIO-Anwendung        │  │
│  └───────────┬────────────┘  │   │  └───────────┬────────────┘  │
│  ┌───────────▼────────────┐  │   │  ┌───────────▼────────────┐  │
│  │ PostgreSQL + Workspace │  │   │  │ PostgreSQL + Workspace │  │
│  └────────────────────────┘  │   │  └────────────────────────┘  │
│                              │   │                              │
│  eigenes LAN, eigene .env    │   │  eigenes LAN, eigene .env    │
└──────────────────────────────┘   └──────────────────────────────┘
```

Getrennt sind damit: Rechner, Netz, Datenbank, Dateiablage, Konfiguration,
Secrets, Benutzerkonten und Backups. Es gibt keinen zentralen Server, keine
gemeinsame Datenbank, kein API-Gateway und keine Instanz beim Hersteller.
Fällt ein Haus aus, merkt kein anderes etwas davon — es gibt schlicht keine
Verbindung.

### Warum nicht mandantenfähig

Viele Produkte lösen das über einen Server für alle Kunden, getrennt durch
eine Mandanten-Spalte. PATIO tut das bewusst nicht:

| Mandantenfähig | PATIO |
|---|---|
| Gemeinsame Datenbank, Trennung per Abfrage | Eigene Datenbank je Haus |
| Ein Fehler in der Filterlogik legt alle Mandanten offen | Ein Fehler betrifft nur das eigene Haus |
| Zentrale Ausfallpunkte | Unabhängige Installationen |
| Daten liegen beim Anbieter | Daten liegen im Büro |

Der Preis: je Haus ein Rechner, je Haus Updates, je Haus ein Backup. Für
Büros, die Projektdaten aus rechtlichen oder vertraglichen Gründen nicht aus
dem Haus geben, ist das der Punkt.

## Innerhalb eines Büros: projektweise Sichtbarkeit

Innerhalb einer Installation trennt PATIO über Rollen und Projektzuordnung.

| Rolle | Sieht |
|---|---|
| **admin** | Alle Projekte, dazu die Benutzerverwaltung und das Audit-Log |
| **user** | Nur zugewiesene Projekte, plus die eigenen Aufgaben, Termine und Notizen ohne Projektbezug |
| **praesentation** | Alle Projekte in den Listen und im Board — sie kann nichts schreiben und bekommt in den Antworten weder Beträge noch Kontaktdaten (eine Ausnahme nennt die [Zugriffskontrolle](/sicherheit/zugriff)) |

Die dritte Rolle trägt das [Board für den Besprechungsraum](/betrieb/board):
ein Gerät, an dem niemand angemeldet ist und in dessen Raum auch Bauherren
sitzen. Sie ist eine Beschränkung, kein Zugangsschlüssel — was sie nicht sehen
darf, verlässt den Server gar nicht erst. Einzelheiten unter
[Zugriffskontrolle](/sicherheit/zugriff).

Die Zuordnung steht in der Tabelle `user_projects` und wird über
**Projekt → Zugriff** gepflegt — den Reiter sieht nur die Verwaltung. Ein
Projekt ohne Zuweisung existiert für den Benutzer nicht: es taucht weder in
der Liste noch in der Suche noch im Portfolio auf.

Das trägt auch für Dokumente, weil es **keinen Weg neben der Anwendung** gibt:
hochgeladene Dateien liegen in der Datenbank, eine Netzfreigabe gibt es nicht,
und der Ordner hinter `WORKSPACE_PATH` ist ausschließlich in den Dienst
eingehängt. Wer eine Datei sehen will, geht durch PATIO — und damit durch
`user_projects`. Ein zweiter Zugriffsweg im Dateisystem hätte die
Projektzuordnung an genau dieser Stelle ausgehebelt.

**Berechnet** wird die Sichtbarkeit an **einer** Stelle: `src/data/access.ts`.
**Durchgesetzt** wird sie in den Routen — sie holen die Liste und reichen sie
weiter; die Repositories wenden eine übergebene Liste an, ermitteln sie aber
nie selbst. Der Unterschied ist wichtig: eine neue Route, die den Aufruf
vergisst, liefert ungefiltert aus. Genau so sind im August siebzehn Lücken
entstanden — alle geschlossen, vollständige Liste unter
[Zugriffskontrolle](/sicherheit/zugriff).

Die Suche filtert über dieselbe Liste, und auch der Kanal für Live-Updates
stellt nur zu, was der Sichtbarkeits-Kontext des Abonnenten abdeckt.

::: warning Der Admin sieht alles
Es gibt keine Ebene über dem Admin und keine Möglichkeit, ein Projekt vor
Administratoren zu verbergen. Wer im Haus Administrator ist, ist eine
organisatorische Entscheidung, keine technische.
:::

## Netz

```
        Büro-LAN
            │
            ▼
  ┌──────────────────┐
  │ Reverse-Proxy    │  ◄── einziger Eingang, terminiert TLS
  └────────┬─────────┘
           │  internes Docker-Netz
  ┌────────▼─────────┐
  │ PATIO-Anwendung  │  Port 3000 nur containerintern
  └────────┬─────────┘
           │  internes Docker-Netz
  ┌────────▼─────────┐
  │ PostgreSQL       │  kein veröffentlichter Port
  └──────────────────┘
```

- Die Datenbank hängt **nur** im internen Netz und veröffentlicht keinen
  Port auf dem Host.
- Die Anwendung gibt Port 3000 nur containerintern frei (`expose`, nicht
  `ports`); erreichbar ist sie ausschließlich über den Proxy.
- Der Rechner selbst ist aus dem Internet nicht erreichbar und soll es nicht
  sein.
- **Ausgehend spricht die Anwendung mit niemandem.** Kein Mailversand,
  keine externen Schriften, kein Aufruf an ein Sprachmodell: eine KI-Akte
  (siehe unten) wird **bei** PATIO abgeholt, nicht von ihm verschickt.

::: info Es gibt nur noch den Compose-Weg
Hier stand ein Hinweis für eine Bare-Metal-Installation. Die wird **nicht mehr
unterstützt** — die zugehörigen Skripte liegen unter
`_archive/scripts/saas-aera/`, und auf dem Server wird ohnehin nie gebaut.

Wer PostgreSQL dennoch nativ betreibt (etwa auf einem Entwicklungsrechner),
erreicht dasselbe über `listen_addresses = 'localhost'` und eine Firewall, die
nur SSH und HTTPS aus dem eigenen Netz zulässt.
:::

## Was die Trennung nicht abdeckt

- **Wer Zugriff auf den Rechner hat, hat Zugriff auf alles.** Datenbank und
  Dateiablage liegen unverschlüsselt auf der Platte; nur einzelne Felder
  sind verschlüsselt. Physischer Zugang und Administratorrechte sind
  organisatorisch zu regeln — eine Festplattenverschlüsselung des Rechners
  ist eine sinnvolle Ergänzung.
- **Backups tragen dieselbe Vertraulichkeit wie das System.** Der Tarball
  enthält die `.env` mit den Secrets; das Skript setzt darum `chmod 600`.
  Eine Netzfreigabe, auf die das ganze Büro zugreift, ist als Backup-Ziel
  ungeeignet.
- **Ein Export verlässt die Rechteprüfung.** Wer ein Protokoll als DOCX
  herunterlädt, hat die Datei danach in der Hand — was damit passiert,
  kontrolliert PATIO nicht mehr.
- **Eine KI-Akte ist ein Export.** Gibt die Verwaltung ein Projekt für den
  KI-Zugriff frei, entsteht daraus eine lesbare Akte, die ausdrücklich dafür
  gedacht ist, von einem Sprachmodell gelesen zu werden. Sie ist ab Werk
  gesperrt und nur für die Verwaltung abrufbar; wohin sie danach geht,
  entscheidet allein, wo dieses Sprachmodell läuft. Siehe
  [KI-Zugriff](/konzepte/ki-zugriff) und [DSGVO](/sicherheit/dsgvo).
