import re, os

replacements = [
    # ue -> ü
    ("Uebersicht", "Übersicht"), ("uebersicht", "übersicht"),
    ("Ueberfaellig", "Überfällig"), ("ueberfaellig", "überfällig"),
    ("Ueberschreit", "Überschreit"), ("ueberschreit", "überschreit"),
    ("Ueberpruef", "Überprüf"), ("ueberpruef", "überprüf"),
    ("Ueberblick", "Überblick"), ("ueberblick", "überblick"),
    ("Uebertrag", "Übertrag"), ("uebertrag", "übertrag"),
    ("Ueberwach", "Überwach"), ("ueberwach", "überwach"),
    ("Ueberleg", "Überleg"), ("ueberleg", "überleg"),
    ("Ausfuehr", "Ausführ"), ("ausfuehr", "ausführ"),
    ("Durchfuehr", "Durchführ"), ("durchfuehr", "durchführ"),
    ("Hoeflichkeitsfloskeln", "Höflichkeitsfloskeln"),
    ("hoeflichkeitsfloskeln", "höflichkeitsfloskeln"),
    ("Vollstaendig", "Vollständig"), ("vollstaendig", "vollständig"),
    ("Langzeitgedaechtnis", "Langzeitgedächtnis"),
    ("Gedaechtnis", "Gedächtnis"), ("gedaechtnis", "gedächtnis"),
    ("Gespraech", "Gespräch"), ("gespraech", "gespräch"),
    ("Bestaetig", "Bestätig"), ("bestaetig", "bestätig"),
    ("Regelmaessig", "Regelmäßig"), ("regelmaessig", "regelmäßig"),
    ("Fliesstext", "Fließtext"), ("fliesstext", "fließtext"),
    ("Praeferenz", "Präferenz"), ("praeferenz", "präferenz"),
    ("Zuverlaessig", "Zuverlässig"), ("zuverlaessig", "zuverlässig"),
    ("Verlaesslich", "Verlässlich"), ("verlaesslich", "verlässlich"),
    ("Zulaessig", "Zulässig"), ("zulaessig", "zulässig"),
    ("Zusaetz", "Zusätz"), ("zusaetz", "zusätz"),
    ("Zurueck", "Zurück"), ("zurueck", "zurück"),
    ("Rueckgaeng", "Rückgäng"), ("rueckgaeng", "rückgäng"),
    ("verfueg", "verfüg"), ("Verfueg", "Verfüg"),
    ("gepruef", "geprüf"),
    ("Pruefe", "Prüfe"), ("pruefe", "prüfe"),
    ("Pruef", "Prüf"), ("pruef", "prüf"),
    ("Bueros", "Büros"), ("bueros", "büros"),
    ("Buero", "Büro"), ("buero", "büro"),
    ("fuehrt", "führt"), ("Fuehrt", "Führt"),
    ("fuehr", "führ"), ("Fuehr", "Führ"),
    ("Rueck", "Rück"), ("rueck", "rück"),
    ("Drueck", "Drück"), ("drueck", "drück"),
    ("Stueck", "Stück"), ("stueck", "stück"),
    ("Stuetz", "Stütz"), ("stuetz", "stütz"),
    ("unterstuetz", "unterstütz"),
    ("Schluessel", "Schlüssel"), ("schluessel", "schlüssel"),
    ("muess", "müss"), ("Muess", "Müss"),
    ("wuerd", "würd"), ("Wuerd", "Würd"),
    ("wuensch", "wünsch"), ("Wuensch", "Wünsch"),
    ("nuetz", "nütz"), ("Nuetz", "Nütz"),
    ("kuenf", "künf"), ("Kuenf", "Künf"),
    ("kuerz", "kürz"), ("Kuerz", "Kürz"),
    ("gekuerzt", "gekürzt"),
    ("gueltig", "gültig"), ("Gueltig", "Gültig"),
    ("natuerlich", "natürlich"), ("Natuerlich", "Natürlich"),
    ("Stuerzt", "Stürzt"), ("stuerzt", "stürzt"),
    ("gruend", "gründ"), ("Gruend", "Gründ"),
    # oe -> ö
    ("unnoetig", "unnötig"), ("Unnoetig", "Unnötig"),
    ("noetig", "nötig"), ("Noetig", "Nötig"),
    ("moeglich", "möglich"), ("Moeglich", "Möglich"),
    ("unmoeglich", "unmöglich"),
    ("hoechst", "höchst"), ("Hoechst", "Höchst"),
    ("groess", "größ"), ("Groess", "Größ"),
    ("Oeffne", "Öffne"), ("oeffne", "öffne"),
    ("eroeffn", "eröffn"),
    ("geloescht", "gelöscht"),
    ("Loeschen", "Löschen"), ("loeschen", "löschen"),
    ("Loesung", "Lösung"), ("loesung", "lösung"),
    ("koenn", "könn"), ("Koenn", "Könn"),
    ("moecht", "möcht"), ("Moecht", "Möcht"),
    ("persoenlich", "persönlich"), ("Persoenlich", "Persönlich"),
    ("hoeflich", "höflich"), ("Hoeflich", "Höflich"),
    ("voellig", "völlig"), ("Voellig", "Völlig"),
    ("woechentl", "wöchentl"), ("Woechentl", "Wöchentl"),
    ("Oesterreich", "Österreich"), ("oesterreich", "österreich"),
    ("OENORM", "ÖNORM"),
    # ae -> ä
    ("Aenderung", "Änderung"), ("aenderung", "änderung"),
    ("Aendere", "Ändere"), ("aendere", "ändere"),
    ("Aendern", "Ändern"), ("aendern", "ändern"),
    ("Aendert", "Ändert"), ("aendert", "ändert"),
    ("Aender", "Änder"), ("aender", "änder"),
    ("aehnlich", "ähnlich"), ("Aehnlich", "Ähnlich"),
    ("aeltesten", "ältesten"), ("aeltere", "ältere"),
    ("aelter", "älter"), ("Aelter", "Älter"),
    ("aeusser", "äußer"), ("Aeusser", "Äußer"),
    ("faellig", "fällig"), ("Faellig", "Fällig"),
    ("faellt", "fällt"), ("Faellt", "Fällt"),
    ("waehr", "währ"), ("Waehr", "Währ"),
    ("waehle", "wähle"), ("Waehle", "Wähle"),
    ("waehlt", "wählt"), ("Waehlt", "Wählt"),
    ("spaeter", "später"), ("Spaeter", "Später"),
    ("naechst", "nächst"), ("Naechst", "Nächst"),
    ("taeglich", "täglich"), ("Taeglich", "Täglich"),
    ("laeuft", "läuft"), ("Laeuft", "Läuft"),
    ("laedt", "lädt"), ("Laedt", "Lädt"),
    ("laesst", "lässt"), ("Laesst", "Lässt"),
    ("Eintraeg", "Einträg"), ("eintraeg", "einträg"),
    ("Ergaenz", "Ergänz"), ("ergaenz", "ergänz"),
    ("Empfaeng", "Empfäng"), ("empfaeng", "empfäng"),
    ("Geschaeft", "Geschäft"), ("geschaeft", "geschäft"),
    ("Erklaer", "Erklär"), ("erklaer", "erklär"),
    ("erwaehnt", "erwähnt"), ("Erwaehnt", "Erwähnt"),
    ("Aufraeum", "Aufräum"), ("aufraeum", "aufräum"),
    ("Betraeg", "Beträg"), ("betraeg", "beträg"),
    ("Nachtraeg", "Nachträg"), ("nachtraeg", "nachträg"),
    ("Beitraeg", "Beiträg"), ("beitraeg", "beiträg"),
    ("Auftraeg", "Aufträg"), ("auftraeg", "aufträg"),
    ("saemtlich", "sämtlich"), ("Saemtlich", "Sämtlich"),
    ("staendig", "ständig"), ("Staendig", "Ständig"),
    ("abhaengig", "abhängig"), ("Abhaengig", "Abhängig"),
    ("unabhaengig", "unabhängig"), ("Unabhaengig", "Unabhängig"),
    ("zustaendig", "zuständig"), ("Zustaendig", "Zuständig"),
    ("Praezise", "Präzise"), ("praezise", "präzise"),
    # ss -> ß
    ("heisst", "heißt"), ("Heisst", "Heißt"),
    ("heissen", "heißen"), ("Heissen", "Heißen"),
    ("schliessen", "schließen"), ("Schliessen", "Schließen"),
    ("schliesst", "schließt"), ("Schliesst", "Schließt"),
    ("abschliessen", "abschließen"), ("Abschliessen", "Abschließen"),
    ("abschliesst", "abschließt"),
    ("einschliesslich", "einschließlich"),
    ("ausschliesslich", "ausschließlich"),
    ("schliesslich", "schließlich"), ("Schliesslich", "Schließlich"),
    ("grosse", "große"), ("Grosse", "Große"),
    ("grossen", "großen"), ("Grossen", "Großen"),
    ("grosser", "großer"), ("Grosser", "Großer"),
    ("grosses", "großes"), ("Grosses", "Großes"),
    ("weiss", "weiß"), ("Weiss", "Weiß"),
    ("Gemaess", "Gemäß"), ("gemaess", "gemäß"),
    # Common standalone words with "fuer", "ueber" etc.
    ("fuer", "für"), ("Fuer", "Für"),
    ("dafuer", "dafür"), ("Dafuer", "Dafür"),
    ("hierfuer", "hierfür"),
    ("wofuer", "wofür"),
    ("ueber", "über"), ("Ueber", "Über"),
]

base = os.path.join(
    r"C:\Users\juliu\OneDrive - Mag. Georg Sima",
    "3_Unternehmen", "KI- Autonom", "bau-os", "docs"
)

count = 0
for root, dirs, files in os.walk(base):
    for fname in files:
        if not (fname.endswith('.md') or fname.endswith('.ts')):
            continue
        fpath = os.path.join(root, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()

        original = content
        for old, new in replacements:
            # Use word boundary aware replacement
            content = re.sub(r'\b' + re.escape(old), new, content)

        if content != original:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(content)
            count += 1
            # Count changes
            changes = sum(1 for a, b in zip(original.split(), content.split()) if a != b)
            print(f"  {os.path.relpath(fpath, base)} ({changes} Wörter)")

print(f"\n{count} Dateien aktualisiert")
