# Netzfreigabe „Dokumente"

Die Projektdokumente liegen als **echte Dateien** unter
`/opt/patio-workspace`. Auf dasselbe Verzeichnis greifen zwei Wege zu:

1. der **PATIO-Dienst** im Container — beim Hochladen und beim Erzeugen von
   Belegen,
2. die **Kolleginnen und Kollegen im Explorer** über diese Freigabe.

Aus diesen zwei Wegen folgt praktisch alles, was auf dieser Seite steht.

## Die eine Zeile, an der es hängt

Der Container läuft als `node` = **UID 1000**. Damit der Dienst eine Datei
ändern kann, die jemand über die Freigabe angelegt hat, muss sie ebenfalls
UID 1000 gehören. Dafür sorgt:

```ini
force user = patio-dateien      # ein Konto mit UID 1000
force group = patio-buero
create mask = 0660
directory mask = 0770
```

Ohne `force user` legte jede Person Dateien unter ihrer eigenen Kennung an —
und der Dienst könnte sie später nicht mehr anfassen. Der Fehler zeigt sich
dann als „Speichern fehlgeschlagen" an einer ganz anderen Stelle.

::: danger Nicht `chown -R patio:patio`
Der Dienst-Benutzer `patio` bekommt beim Anlegen irgendeine andere UID — mit
`adduser` die nächste freie, mit `useradd -r` sogar eine **unter** 1000.
Gibt man ihm das Dokumentenverzeichnis, passt es nicht mehr zur UID, unter
der der Container schreibt.

Richtig: `sudo chown -R 1000:1000 /opt/patio-workspace`
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

Ein im Explorer gelöschter Projektordner wäre sonst **sofort weg** — und die
Datensätze in der Datenbank zeigten ins Leere.

Gelöschtes landet daher unter `.papierkorb/<benutzername>/` und behält dabei
seine ursprüngliche Ordnerstruktur (`recycle:keeptree`). Der Ordner trägt das
Attribut „versteckt": der Explorer blendet ihn aus, damit ihn niemand
versehentlich als Projektordner benutzt.

**Zum Wiederherstellen** im Explorer „Ausgeblendete Elemente" einschalten und
die Datei aus `.papierkorb/<eigener Name>/…` zurückkopieren.

::: warning Der Papierkorb ist eine Zwischenlösung
Er ist bis zur Fertigstellung des Papierkorbs **in der Anwendung** (eigenes
Arbeitspaket) die einzige Rückholmöglichkeit zwischen zwei nächtlichen
Sicherungen. Er wird **nicht** automatisch geleert — den Füllstand
gelegentlich ansehen:

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
