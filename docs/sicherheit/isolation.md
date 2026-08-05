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

Die Zuordnung steht in der Tabelle `user_projects` und wird über
**Projekt → Zugriff** gepflegt. Ein Projekt ohne Zuweisung existiert für den
Benutzer nicht — es taucht weder in der Liste noch in der Suche noch im
Portfolio auf.

Durchgesetzt wird das an **einer** Stelle: `src/data/access.ts`. Die
Repositories bauen ihre WHERE-Klauseln daraus, die Suche filtert darüber,
und auch der Kanal für Live-Updates stellt nur zu, was der
Sichtbarkeits-Kontext des Abonnenten abdeckt.

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
- Ausgehend spricht die Anwendung nur mit dem SMTP-Server.

Bei einer Bare-Metal-Installation gilt dasselbe über andere Mittel:
`listen_addresses` von PostgreSQL auf `localhost`, Firewall auf SSH und
HTTPS aus dem eigenen Netz beschränkt.

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
