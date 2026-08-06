# Netzfreigabe „Dokumente"

`/opt/patio-workspace` ist ein **ganz normaler Netzordner** für alles, was
nicht in eine Datenbank gehört: Pläne, CAD-Dateien, große Scans, Fotomappen.
Erreichbar im Explorer unter `\\patio.sima.intern\Dokumente`.

## Zwei Ablagen, mit Absicht getrennt

Das ist die wichtigste Seite dieser Doku, weil es sonst zu Missverständnissen
führt:

| | **Freigabe „Dokumente"** | **In PATIO hochgeladen** |
|---|---|---|
| Wo es liegt | im Ordner auf dem Server | in der Datenbank |
| Wofür | Pläne, CAD, große Scans | Verträge, Protokolle, Schriftverkehr |
| Projektbezug | nur der Ordnername | echt, samt Rechten |
| Rechte | die der Freigabe (Gruppe) | projektweise wie im ganzen Programm |
| Suche | Windows-Suche | Volltext samt Inhalt |
| In der Sicherung | ja (Dateien) | ja (Datenbank) |
| Obergrenze je Datei | keine | 50 MB (`MAX_UPLOAD_MB`) |

**Die Anwendung liest und schreibt in diesem Ordner nichts.** Sie zeigt ihn
auch nicht an. Wer eine Datei in PATIO hochlädt, legt sie in die Datenbank;
wer sie in den Ordner kopiert, legt sie in die Freigabe. Beides ist richtig —
nur eben für verschiedene Dinge.

::: tip Warum nicht alles in einer Ablage
Ein 800-MB-Plansatz gehört nicht in eine Datenbank: er bläht jede Sicherung
auf und muss durch HTTP hindurch. Umgekehrt kann ein Ordner keine
projektweisen Rechte, keine Volltextsuche und keinen Papierkorb — und genau
das braucht ein Vertrag. Deshalb zwei Ablagen und eine klare Aufteilung.
:::

::: warning Die Freigabe ist über PATIO NICHT erreichbar
Das ist Absicht. Frühere Fassungen boten `GET /api/files/read?path=…`,
`POST /api/files/mkdir` und ein Löschen über einen Pfad an — alle drei ohne
Rechteprüfung. Wer ein Konto hatte, kam damit an jedes Dokument. Diese Wege
sind entfernt; die Freigabe wird ausschließlich über SMB bedient, und dort
gelten die Rechte von Samba.
:::

## Die eine Zeile, an der es hängt

Damit Kolleginnen und Kollegen die Dateien der jeweils anderen ändern können,
landen alle Dateien unter derselben Kennung. Dafür sorgt:

```ini
force user = patio-dateien      # ein Konto mit UID 1000
force group = patio-buero
create mask = 0660
directory mask = 0770
```

Ohne `force user` legte jede Person Dateien unter ihrer eigenen Kennung an —
und der Dienst könnte sie später nicht mehr anfassen. Der Fehler zeigt sich
dann als „Speichern fehlgeschlagen" an einer ganz anderen Stelle.

Ohne `force user` legte jede Person Dateien unter ihrer eigenen Kennung an —
und die Kollegin könnte sie danach nicht mehr ändern.

::: tip UID 1000 bleibt, ist aber kein Muss mehr
Frühere Fassungen des Dienstes schrieben selbst in diesen Ordner; deshalb
musste er der Container-Kennung (`node` = UID 1000) gehören. Das tut er nicht
mehr — die Anwendung fasst den Ordner nicht an. Die Einrichtung unten behält
UID 1000 trotzdem bei: sie ist erprobt, und ein Alt-Bestand aus der Zeit davor
bleibt damit lesbar.
:::

## Einrichtung

```bash
# Gruppe und das Konto, unter dem alle Dateien landen
sudo groupadd -g 1000 patio-buero
sudo useradd -u 1000 -g patio-buero -M -s /usr/sbin/nologin patio-dateien
sudo chown -R 1000:1000 /opt/patio-workspace

# Konfiguration einbinden
echo 'include = /opt/patio/deploy/smb-patio.conf' | sudo tee -a /etc/samba/smb.conf
sudo testparm                       # muss ohne Fehler durchlaufen
sudo systemctl reload smbd

# Je Person: in die Gruppe aufnehmen und ein Samba-Passwort setzen
sudo usermod -aG patio-buero anna
sudo smbpasswd -a anna
```

Das Samba-Passwort ist **getrennt** vom PATIO-Passwort. Beide gehören derselben
Person, sind aber zwei Systeme — das ist bewusst so und wird sich erst ändern,
wenn es eine gemeinsame Benutzerverwaltung gibt.

Am Arbeitsplatz verbinden: `\\patio.sima.intern\Dokumente`

## Was sonst noch eingestellt ist

| Einstellung | Warum |
|---|---|
| `server min protocol = SMB3` | SMB1 gilt seit Jahren als unsicher (WannaCry lief darüber) |
| `server signing = mandatory` | verhindert das Übernehmen der Verbindung im selben Netz |
| `hosts allow` | die Freigabe hört nur auf dem Bürosegment |
| `valid users = @patio-buero` | **nicht** „jeder" — hier liegen Honorarnoten und Personendaten |
| `map to guest = never` | kein Gastzugang |
| `follow symlinks = no` | sonst wäre über die Freigabe der ganze Server lesbar |
| `disable netbios = yes` | der Server wird über DNS gefunden, nicht über Zurufe ins Netz |

## Der Papierkorb der Freigabe

Ein im Explorer gelöschter Projektordner wäre sonst **sofort weg**.

Gelöschtes landet daher unter `.papierkorb/<benutzername>/` und behält dabei
seine ursprüngliche Ordnerstruktur (`recycle:keeptree`). Der Ordner trägt das
Attribut „versteckt": der Explorer blendet ihn aus, damit ihn niemand
versehentlich als Projektordner benutzt.

**Zum Wiederherstellen** im Explorer „Ausgeblendete Elemente" einschalten und
die Datei aus `.papierkorb/<eigener Name>/…` zurückkopieren.

::: warning Er ist die einzige Rückholmöglichkeit für die Freigabe
Der Papierkorb **in der Anwendung** (Verwaltung → Papierkorb) gilt für
Projekte in der Datenbank — er reicht nicht in diesen Ordner hinein. Für
alles, was im Explorer gelöscht wird, ist dieser Papierkorb hier zwischen zwei
nächtlichen Sicherungen die einzige Rettung. Er wird **nicht** automatisch
geleert — den Füllstand gelegentlich ansehen:

```bash
du -sh /opt/patio-workspace/.papierkorb/*
```
:::

Nicht aufgehoben werden Office-Sperrdateien und Windows-Beiwerk
(`*.tmp`, `~$*`, `.~lock.*`, `Thumbs.db`, `desktop.ini`) — sonst füllt sich der
Papierkorb mit Müll.

## Prüfen, dass es stimmt

```bash
# 1. Konfiguration gültig?
sudo testparm

# 2. Datei über die Freigabe anlegen, dann auf dem Server nachsehen:
stat -c '%u %g %n' /opt/patio-workspace/<Projekt>/<Datei>
#    muss 1000 1000 zeigen — egal, wer sie geschrieben hat

# 3. Kann der Dienst dieselbe Datei ändern?
docker exec patio-app touch /workspace/<Projekt>/<Datei>

# 4. Landet Gelöschtes im Papierkorb?
find /opt/patio-workspace/.papierkorb -type f
```

Diese vier Schritte wurden gegen einen echten Samba-Server durchgespielt:
Schreiben durch ein Gruppenmitglied, Eigentümer UID 1000, Löschen mit
Ablage unter `.papierkorb/<name>/<Projekt>/`, und ein Konto außerhalb der
Gruppe erhält `NT_STATUS_ACCESS_DENIED`.
