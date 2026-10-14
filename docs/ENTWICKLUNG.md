# ClubShot – technische Dokumentation

## Aufbau

- **Eine Datei:** `index.html` enthält HTML, CSS und JavaScript (bewusst, für einfaches Hochladen).
- **Bibliotheken** (lokal in `vendor/`): html2canvas 1.4.1 (Export), localForage 1.10.0 (IndexedDB),
  MediaPipe Tasks Vision 1.0.1 + Modell `selfie_multiclass_256x256.tflite` (Freistellen, Telemetrie im Bundle deaktiviert),
  Schriften als woff2 (OFL / Apache 2.0, Lizenztexte in `vendor/fonts/`).
- **Content-Security-Policy** im `<head>` erlaubt nur Dateien vom eigenen Server. Neue externe Quellen funktionieren
  deshalb absichtlich nicht.

## Speicher (IndexedDB über localForage)

Alle Vereinsdaten liegen getrennt je Vereinscode (`vg_c_<CODE>_…`, Demo: `vg_c_DEMO_…`):

| Schlüssel | Inhalt |
|---|---|
| `vg_c_<CODE>_stammdaten` | Spieler (inkl. Fotos als Data-URL), Gegner, Sponsoren, Hintergründe, Mannschaften, Positionen, Einwilligungs-Schalter |
| `vg_c_<CODE>_slot_v1..v3` | Die drei Versionen: Eingaben, Positionen, Design je Reiter (`tabSettings`), Texte, Spielplan |
| `vg_c_<CODE>_current_version` | zuletzt geöffnete Version |
| `vg_club` | aktuell freigeschalteter Verein (Code, Name, Wappen, Ablaufdatum, Paket) |
| `vg_prefs` | Geräte-Einstellungen; Vereins-Einstellungen in `prefs.byClub[<ns>]` (Versionsnamen, Backup-Datum, Ansicht `ui`) |
| `vg_active_tab` | zuletzt geöffneter Reiter |

Codewechsel → `switchClubTo()` speichert, bietet ggf. die Übernahme der bisherigen Daten an und lädt die Seite neu.

## Wichtige Bausteine in `index.html`

| Bereich | Funktionen / Konstanten |
|---|---|
| Speichern/Laden einer Version | `collectSlotData()`, `applySlotData()`, `saveSlotNow()`, `scheduleSave()` |
| Rückgängig | `recordHistory()`, `undoAction()`, `redoAction()` (Verlauf nur im Arbeitsspeicher) |
| Design je Reiter | `buildDesignControls()`, `updateTabDesign()`, `EXTRA_DESIGN` (generische Zusatzfelder) |
| Verschieben/Skalieren | `.draggable-text`, `.draggable-img`, `.movable`, `bindDraggable()`, Positionen in `positions` |
| Beitrag ↔ Story gemeinsam | `syncKeys()`, `syncPartners()`, Schalter 🔗 in der Werkzeugleiste (`prefs.syncFormats`, je Gerät) |
| Sponsorenlogos einzeln | Option `sponsorFree` (EXTRA_DESIGN), Logo-IDs `spl-<Vorlage>-<Sponsor>`, Positionen über `pendingPositions` |
| Wappen-Anordnung | `logoDir` (row/column), `logoGap` (EXTRA_DESIGN) → CSS `--logos-gap`, Klasse `logos-stacked` |
| Zurücksetzen | Dialog `resetTabDefaults()` (einzelne Elemente + Bereiche), komplett `resetTabAll()` |
| Feste Beschriftungen | `LABEL_DEFS`, `L(tab, key)`, `applyLabels()` |
| Export | `renderElementToCanvas()` – Kopie außerhalb des Bildschirms, Bilder werden vorab in Export-Auflösung gerastert (`rasterizeFitImage`, `replaceBackgroundImages`), dann html2canvas mit Faktor 3 |
| Lizenz | `fetchLicenseList()`, `findLicenseEntry()` (PBKDF2, Salt `vereinsgrafik-lizenz-v1` – nicht ändern, sonst sind alle Codes ungültig) |
| Pakete | `ADVANCED_TABS`, `isAdvanced()`, CSS-Klasse `adv-only` (im Basis-Paket ausgeblendet) |
| Ansicht anpassen | `UI_SECTIONS`, `data-section`-Attribute, `applyUiPrefs()` |
| Spielplan-Import | `parseSchedule()` |
| Hilfe | `HELP_TEXTS`, `HELP_VIDEOS` |

**Neue Advanced-Funktion:** Element im HTML mit `class="adv-only"` versehen und in der Logik `isAdvanced()` prüfen.
**Neuer Reiter-Bereich zum Ausblenden:** Element mit `data-section="<name>"` markieren und in `UI_SECTIONS` eintragen.

## Service Worker (`sw.js`)

- `index.html` und Rechtstexte: zuerst aus dem Netz, offline aus dem Zwischenspeicher.
- `vendor/`, `icons/`, Logo: aus dem Zwischenspeicher.
- `vereine.txt` und `Wappen/`: immer aus dem Netz (nie zwischengespeichert).
- Bei jeder neuen Version `CACHE_VERSION` erhöhen; alte Zwischenspeicher werden automatisch gelöscht.

## Bekannte Grenzen

- Die Freischaltung ist clientseitig und technisch umgehbar – rechtlicher Schutz über die AGB.
- html2canvas wird nicht mehr weiterentwickelt; Exporte nach Browser-Updates stichprobenartig prüfen.
- Fotos liegen als Data-URL im Speicher (ca. ⅓ größer als nötig). Umstellung auf Blobs wäre möglich, aber mit Daten-Migration.
- Gelegentlich fragt der Browser beim Laden vermeintliche Bildadressen aus dem Programmcode an (404, harmlos).
