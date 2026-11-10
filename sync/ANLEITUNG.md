# Vereins-Sync einrichten (Cloudflare) – Klick-Anleitung

Dauer: ca. 30 Minuten, einmalig. Kosten: bei bis zu ca. 60 Vereinen 0 € (Gratis-Rahmen von Cloudflare R2: 10 GB).
Cloudflare verlangt für R2 trotzdem eine hinterlegte Zahlungsart.

> Die Menü-Namen bei Cloudflare ändern sich ab und zu. Wenn etwas anders heißt, such nach dem fett gedruckten Begriff.

## 1. Speicher anlegen (R2)

1. Auf **dash.cloudflare.com** mit dem Konto anmelden, über das auch match-shot.de läuft.
2. Links **R2 Object Storage** öffnen → R2 aktivieren (Gratis-Plan, Zahlungsart hinterlegen).
3. **Create bucket** (Bucket erstellen):
   - Name: `matchshot-sync`
   - Location / Standort: **Specify jurisdiction → European Union (EU)**
   - Erstellen.

## 2. Sync-Programm anlegen (Worker)

1. Links **Workers & Pages** → **Create** → **Worker** → Vorlage „Hello World“.
2. Name: `matchshot-sync` → **Deploy**.
3. **Edit code**: den kompletten Inhalt von `sync/worker.js` (aus dem Projekt) hineinkopieren und den alten Text ersetzen → **Deploy**.

## 3. Speicher verbinden

Im Worker `matchshot-sync` → **Settings** (Einstellungen):

1. **Bindings** → **Add** → **R2 bucket**
   - Variable name: `BUCKET` (genau so, in Großbuchstaben)
   - Bucket: `matchshot-sync`
   - Speichern.
2. **Triggers** → **Cron Triggers** → **Add**: `17 3 * * 1` (räumt jeden Montag früh auf).
3. *(Optional)* **Variables**: Die Standardwerte stehen schon im Programm. Ändern nur bei Bedarf:
   - `QUOTA_MB` = Speicher je Verein in MB (Standard 600)
   - `MAX_SPACES` = Sync-Bereiche je Verein (Standard 3)
   - `DELETE_AFTER_DAYS` = Löschen nach Lizenz-Ende (Standard 180)

## 4. Adresse sync.match-shot.de

Im Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `sync.match-shot.de` → Speichern.
(Das klappt, weil match-shot.de bei Cloudflare verwaltet wird. Das Zertifikat kommt automatisch, kann ein paar Minuten dauern.)

## 5. Prüfen

Im Browser **https://sync.match-shot.de/v1/ping** öffnen. Es muss stehen: `{"ok":true}`

Dann Bescheid geben – danach testen wir mit zwei Handys in der Testversion.

---

## Gut zu wissen

- **Wer darf?** Nur Vereine aus `vereine.txt` (auf match-shot.de) mit Paket **advanced** und gültigem Datum.
  Neue Vereine wie gewohnt in `vereine.txt` eintragen – für den Sync ist nichts extra nötig.
  Voraussetzung: Der Code steht als **Hash** in der Liste (mit `code-generator.html` erzeugt – bei allen aktuellen Vereinen der Fall).
- **Was sieht Cloudflare / was siehst du?** Nur verschlüsselte Dateien. Ohne Vereins-Passwort kann niemand etwas lesen – auch du nicht.
- **Speicher ansehen:** R2 → `matchshot-sync` → Ordner `v1/<Vereins-Hash>/…`. Ein Verein meldet „Speicher voll“?
  Dort den Ordner des Vereins löschen (der Verein lädt danach einfach neu hoch) oder `QUOTA_MB` erhöhen.
- **Update des Programms:** Wenn sich `sync/worker.js` ändert, den Inhalt wie in Schritt 2.3 erneut einfügen → Deploy.
- **Rechtliches:** Die Datenschutzerklärung (Abschnitt 5b) ist ergänzt. Für die Spielerdaten handelst du im Auftrag des Vereins –
  vor dem Start für Kunden bitte einmal prüfen lassen, ob ihr dafür einen Vertrag zur Auftragsverarbeitung (AVV) mit den Vereinen braucht.
