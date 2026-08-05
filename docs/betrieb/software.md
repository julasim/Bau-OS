# Software installieren

Zwei Wege. **Docker Compose** ist der empfohlene: die Datenbank kommt als
Container mit, die Versionen sind festgelegt, ein Update ist ein Rebuild.
**Bare Metal** ist der Weg für Rechner, auf denen kein Docker laufen soll.

---

## Weg A — Docker Compose (empfohlen)

### Docker installieren

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Prüfen:

```bash
docker --version
docker compose version
```

### Was der Stack enthält

| Service | Image | Funktion |
|---|---|---|
| `postgres` | `postgres:16` | Datenbank, nur im internen Netz |
| `app` | Build aus `Dockerfile` | PATIO-API und Weboberfläche |

Zwei Container, mehr nicht. Der frühere `ollama`-Service ist mit dem Umbau
entfallen — auf einem Firmenserver ohne Internet ließ sich sein Image nicht
ziehen, und weil `app` per `depends_on` daran hing, kam der **gesamte** Stack
nicht hoch.

::: tip Kein pgvector mehr nötig
Bis vor Kurzem verlangte das Schema die Extension `pgvector` und damit das
Spezial-Image `pgvector/pgvector:pg16`. Die Migrationen `040` und `041`
haben die Vektor-Reste entfernt; PATIO läuft auf einem gewöhnlichen
`postgres:16`. Das ist genau der Punkt, an dem ein Firmenserver ohne
Internetzugang sonst gescheitert wäre.
:::

### Reverse-Proxy

Der Compose-Stack bringt keinen eigenen HTTPS-Eingang mit; `app` gibt Port
3000 nur containerintern frei. Davor gehört ein Reverse-Proxy, der TLS
terminiert.

Zwei Varianten:

- **Gemeinsamer Edge-Proxy** — `docker-compose.yml` hängt `app` an ein
  externes Docker-Netz namens `proxy`. Das Netz muss vor dem ersten Start
  existieren.
- **Standalone** — `docker/docker-compose.standalone.yml` bringt einen
  eigenen Caddy-Container mit; dann sind `CADDY_DOMAIN` und `CADDY_EMAIL` in
  der `.env` zu setzen.

::: warning Kein Let's Encrypt im internen Netz
Ein Zertifikat von Let's Encrypt setzt einen öffentlich auflösbaren Namen
voraus. Im Büronetz muss das Zertifikat von der internen CA kommen oder
selbst signiert sein — dann ist es einmalig auf den Arbeitsplätzen als
vertrauenswürdig zu hinterlegen.
:::

Die SSE-Route `/api/events` darf der Proxy **nicht puffern**, sonst kommen
die Live-Updates nicht an. Bei Caddy:

```caddyfile
@stream path /api/events*
reverse_proxy @stream app:3000 {
    flush_interval -1
    transport http { read_timeout 24h  write_timeout 24h }
}
reverse_proxy app:3000
```

---

## Weg B — Bare Metal

### Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
node --version
```

### Git und Build-Werkzeuge

```bash
sudo apt-get install -y git build-essential
```

`build-essential` wird für native Module gebraucht (`bcrypt`, `pdf-parse`).

### PostgreSQL 16

```bash
sudo apt-get install -y postgresql-16

sudo -u postgres createuser patio --pwprompt
sudo -u postgres createdb -O patio patio
```

Die benötigten Extensions (`uuid-ossp`, `pg_trgm`, `unaccent`) legt Migration
`001` selbst an — dafür braucht die Rolle allerdings ausreichende Rechte
beim ersten Lauf.

Verbindung prüfen:

```bash
psql "postgres://patio:PASSWORT@localhost:5432/patio" -c "SELECT 1;"
```

::: warning Datenbank nicht ans Netz
`listen_addresses` in `postgresql.conf` auf `localhost` lassen. PATIO läuft
auf demselben Rechner; eine von außen erreichbare Datenbank ist eine
unnötige Angriffsfläche.
:::

### Automatischer Installer

Für Ubuntu gibt es ein Skript, das den Bare-Metal-Weg komplett übernimmt:

```bash
sudo bash scripts/install.sh
```

Es richtet ein: Node.js 24, PostgreSQL samt Rolle und Extensions, den
PATIO-Build, den Dienst-Benutzer, die `.env`, eine systemd-Unit und das
CLI-Werkzeug `patio`. Abgefragt werden Installations- und
Workspace-Verzeichnis, das erste Admin-Konto und der Port.

## Nächster Schritt

→ [PATIO deployen](/betrieb/deployment)
