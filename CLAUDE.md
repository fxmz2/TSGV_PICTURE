# Hinweise für die Arbeit an ClubShot

- Produkt: ClubShot (Web-App für Vereinsgrafiken). Inhaber und Ansprechpartner spricht Deutsch – Oberfläche, Texte und Antworten auf Deutsch, laienverständlich.
- Die App bleibt **eine Datei** (`index.html`); keine Build-Tools, keine externen CDNs oder Fonts (CSP und DSGVO).
- Bei jeder Änderung: `APP_VERSION` und `<title>` in `index.html` sowie `CACHE_VERSION` in `sw.js` erhöhen.
- Vor dem Abschluss die Tests laufen lassen: `cd tests && npm test` (siehe `README.md`). Neue Funktionen bekommen einen Testfall in `tests/run.js`.
- Nie echte Spielerfotos oder personenbezogene Daten ins Repository legen; Testbilder erzeugen die Tests selbst.
- `LICENSE_SALT` niemals ändern (alle Vereinscodes würden ungültig).
- Gespeicherte Daten älterer Versionen müssen weiter funktionieren – neue Felder immer mit Standardwert laden.
- Architektur und Speicherschlüssel: `docs/ENTWICKLUNG.md`.
