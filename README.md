# ClubShot – Social-Media-Grafiken für Vereine

ClubShot ist eine Web-App, mit der Fußballvereine auf dem Handy Instagram-Grafiken erstellen:
Spielankündigung, Aufstellung, Tor, Ergebnis, Kader, Player of the Match, Kalender, Geburtstag,
Neuzugang/Spielervorstellung, Danke an Sponsor, Wochenend-Ergebnisse und Eckball-Taktik.

- Läuft komplett im Browser, installierbar als App (PWA), funktioniert offline.
- **Alle Vereinsdaten (Spieler, Fotos, Termine …) bleiben lokal auf dem Gerät** – nichts wird an einen Server geschickt.
- Freischaltung je Verein über einen Vereinscode (Liste `vereine.txt` auf dem Server).

## Dateien, die auf den Server gehören

| Datei / Ordner | Zweck |
|---|---|
| `index.html` | Die komplette App (eine Datei) |
| `sw.js` | Service Worker (Offline-Betrieb, Updates) |
| `manifest.json`, `icons/`, `clubshot.png` | App-Name, Icons, Logo |
| `vendor/` | Bibliotheken, Schriften, Freistell-Modell (alles lokal, keine Verbindung zu Google & Co.) |
| `vereine.txt` | Liste der freigeschalteten Vereine (siehe unten) |
| `Wappen/` | Vereinswappen der Kunden |
| `impressum.html`, `datenschutz.html`, `agb.html` | Rechtstexte |
| `.nojekyll` | nur für GitHub Pages nötig |

**Nicht** hochladen (bleiben nur im Repository): `code-generator.html`, `tests/`, `docs/`, `README.md`, `CLAUDE.md`.

## Vereine verwalten (`vereine.txt`)

Eine Zeile pro Verein:

```
CODE-HASH = Vereinsname = Wappen-Datei = gültig bis = Paket
```

- **CODE-HASH**: mit `code-generator.html` erzeugen (lokal im Browser öffnen). So steht der Code nicht lesbar in der Datei.
- **Wappen-Datei**: z.B. `Wappen/TSGV_Rechberg.jpg` (Groß-/Kleinschreibung beachten, keine Umlaute).
- **gültig bis**: Ende der Saisonlizenz, z.B. `2050-12-31`. Zum Verlängern nur das Datum ändern.
- **Paket**: `basis` oder `advanced` (ohne Angabe: advanced).
  - Basis: Ankündigung, Aufstellung (auch 7er/9er), Tor, Ergebnis (inkl. Halbzeit, Absage, Countdown),
    Kader, POTM, Kalender, Geburtstag, Teamfoto, Freie Vorlage.
  - Advanced zusätzlich: Eckball, Neuzugang/Vorstellung, Danke-Sponsor, Wochenende, Sponsorenleisten,
    „Präsentiert von“, zusätzliche Spieler, Freistellen (KI), Schrift-Effekte, Spielplan-Import, Grafik-Paket.
- Zeile löschen = Code beim nächsten Start (mit Internet) gesperrt.
- `DEMO` ist fest eingebaut (alle Funktionen, Grafiken mit Wasserzeichen).

## Ein Update veröffentlichen

1. In `index.html` die Versionsnummer erhöhen (`APP_VERSION` und `<title>`).
2. In `sw.js` `CACHE_VERSION` erhöhen – sonst bekommen installierte Apps das Update nicht.
3. Tests laufen lassen (siehe unten).
4. Auf `main` veröffentlichen → **Testversion** (GitHub Pages).
5. Wenn alles passt: `main` in den Zweig `live` übernehmen → **Kundenversion** (Netlify veröffentlicht automatisch).

### Zweige

| Zweig | Wofür | Wo |
|---|---|---|
| `main` | Testversion | GitHub Pages |
| `live` | Kundenversion | Netlify (verbunden mit GitHub, Einstellungen in `netlify.toml`) |

`netlify.toml` legt fest: kein Build, Hauptordner veröffentlichen, App/`sw.js`/`vereine.txt` immer frisch laden,
interne Dateien (`tests/`, `docs/`, `code-generator.html`, `README.md`, `CLAUDE.md`) auf Netlify nicht ausliefern.

**Code-Vorrat:** In `code-generator.html` unter „Code-Vorrat erzeugen“ z.B. 30 Codes auf einmal erstellen.
Die Codes kommen als CSV in die private Tabelle, die Hash-Zeilen als gesperrte Einträge (`# R07 = HASH`) in `vereine.txt`.
Zum Freischalten wird `# R07 = HASH` durch `HASH = Verein = Wappen/Datei.png = gültig bis = Paket` ersetzt.

**Neuen Verein freischalten:** Zeile aus `code-generator.html` in `vereine.txt` eintragen und Wappen in `Wappen/` legen –
auf `live` (sofort für den Kunden) **und** auf `main` (damit beide Listen gleich bleiben).

## Hilfe-Videos verlinken

In `index.html` die Konstante `HELP_VIDEOS` füllen, z.B.:

```js
const HELP_VIDEOS = { post: 'https://youtu.be/…', story: 'https://youtu.be/…' };
```

Die Links erscheinen dann im ❓-Hilfetext des jeweiligen Reiters.

## Tests

```
cd tests
npm install
npx playwright install chromium
npm test
```

Die Tests starten einen lokalen Webserver, verwenden eine eigene Test-Lizenzliste
(`tests/fixtures/vereine.test.txt`) und erzeugen ihre Testbilder selbst.

Weitere technische Details: [`docs/ENTWICKLUNG.md`](docs/ENTWICKLUNG.md).
