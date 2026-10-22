# Match-Shot – technische Dokumentation

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
| Design je Reiter | `buildDesignControls()`, `updateTabDesign()`, `EXTRA_DESIGN` (generische Zusatzfelder). Bereiche: „🎨 Farben & Schrift“ (`colors`, inkl. Vereinsfarben-Spiegel `mirrorClubColor()` und Kästen `--box-bg`/`--box-fg`) und „🖼️ Hintergrund & Formen“ (`design`) |
| Verschieben/Skalieren | `.draggable-text`, `.draggable-img`, `.movable`, `bindDraggable()`, Positionen in `positions` |
| Beitrag ↔ Story gemeinsam | `syncKeys()`, `syncPartners()`, Schalter 🔗 in der Werkzeugleiste (`prefs.syncFormats`, je Gerät) |
| Sponsorenlogos einzeln | Option `sponsorFree` (EXTRA_DESIGN), Logo-IDs `spl-<Vorlage>-<Sponsor>`, Positionen über `pendingPositions` |
| Wappen-Anordnung | `logoDir` (row/column), `logoGap` (EXTRA_DESIGN) → CSS `--logos-gap`, Klasse `logos-stacked` |
| Aufstellung | `buildFormation()`: Spieler als `.player-card.movable` (IDs `pc-<Feld>-<Formation>-<Nr>`, Positionen je Formation über `pendingPositions`), Kapitän `in-captain`, ausgeblendete Namen `pitchHideNames`, Spielfeld als SVG-Bild `fieldSvgUri()` (halb/ganz, von oben/schräg, Linien/dunkel/Rasen), Gegner-Kopf `lineup-match`, Namensformat `pitchNameMode`, Profi-Look `pc-pro` |
| Design-Stile | `STYLE_PRESETS`, `STYLE_BASE`/`STYLE_EXTRA`, eigene Stile in `stammdaten.designStyles` (`saveCurrentStyle()`, `applyStyle()`) |
| Video (Reel) | `renderVideoLayers()` (Grundbild + je Element eine Ebene über html2canvas), `recordVideo()` (Canvas + MediaRecorder, MP4 bevorzugt), `addVideoButtons()`; CSP erlaubt dafür `media-src blob:` |
| Textausrichtung | Je Reiter `textAlign` (Klassen `talign-left/right` am Reiter), je Element `data-align` über den Knopf ⇔ in der Werkzeugleiste (`cycleAlignSelected()`, gespeichert in `positions[id].align`) |
| Eigene Schriften | `stammdaten.fonts` (Daten-URL), `registerCustomFonts()` als `@font-face` im `<style>` (damit auch der Export sie kennt; CSP `font-src data:`), `refreshFontSelects()` |
| Mehrere Spieler | `openBulkDialog()`, `runBulkExport()` (Neuzugang/Vorstellung je Spieler als Bild und/oder Video; nutzt `packFiles`) |
| Spielernamen | `playerDisplayName(name, fmt)` / `playerNameHtml()` mit `full`, `stack`, `last`, `first`, `short`, `nick` (Spitzname `p.nick`, sonst Nachname). Format je Reiter in `NAME_FMT_FIELDS` (`torNameFmt` …, alte `*NameStack`-Werte werden über `migrateNameFmt()` übernommen), Zusatzspieler `xpNameFmt`. `renameEntry(type, idx)` (Spieler, Gegner, Sponsoren) ersetzt den Namen auch in allen drei gespeicherten Versionen und nimmt bei Sponsoren die Logo-Positionen (`spl-…`) mit |
| Landingpage | Im `#license-overlay` (Klasse `landing-mode`, Abschnitte `.landing-only`): erscheint nur, solange auf dem Gerät kein Verein freigeschaltet ist (`localStorage.vg_unlocked`, gesetzt über `markUnlocked()`; `html.lp-boot` zeigt sie schon vor dem App-Start). Bilder in `landing/` (aus dem Demo-Verein erzeugt, keine echten Personen). Links für Bestellung und Instagram in `LANDING_LINKS` eintragen |
| Spielform 7er/9er | Ergibt sich aus der Formation (`formations`, Summe der Reihen); `fillFormationOptions()`, `setFormation()`, `setTeamSize()`, `lineupSize()`. Überzählige Eingabezeilen werden ausgeblendet |
| Präsentiert von | Je Vorlage ein `.presented-by` (`createPresentedBy()`, id `pb-<Vorlage>`), Inhalt aus `pbSponsor`/`pbText` (EXTRA_DESIGN), `renderPresentedBy()` in `updateTabDesign()` |
| Ergebnis-Modi | `ERG_MODES` (ergebnis, halbzeit, absage, countdown), `setErgMode()`, gespeichert als `ergMode`; Countdown-Datum `erg-cd-date` |
| Freie Vorlage | Reiter `frei`, `updateFrei()`, Eingaben `in-frei-*` |
| Spezial-Foto | Drittes Spielerfoto `specialImg`/`specialCutImg`, Auswahl je Reiter „⭐ Spezial-Foto“ (`photoTypeOf` = `special`, ohne Spezial-Foto → normales Foto), Foto-Fenster `openPhotoDialog()`, Mehrfach-Upload `_SPEZIAL` |
| Mannschaftsfoto | Reiter `teamfoto`, Fotos in `stammdaten.teamPhotos` [{id,name,img}] (Backup/Import „Mannschaftsfotos“), `updateTeamfoto()`, Eingaben `in-tf-*`. Verteilen per Ziehen: `tfBoard` {back, middle, front, coaches, missing} (Spielernamen, von links), `renderTfBoard()`, `tfMove()`, `tfAutoFill()`, Reihen aus-/zuklappen (`tfBoard.off`, `tfBoard.folded`), Listen-Ansicht (`tfBoard.view = 'list'`, `tfReorder()`); befüllt die Textfelder über `tfSyncText()` |
| Veröffentlichen | `main` = Testversion (GitHub Pages), `live` = Kundenversion (Netlify, `netlify.toml`). App-Änderungen nur nach ausdrücklicher Freigabe von `main` nach `live` übernehmen; neue Vereine (`vereine.txt`, `Wappen/`) auf beiden Zweigen eintragen |
| Logo | Quelle als SVG in `docs/logo/matchshot-logo.html` (im Browser über den Testserver öffnen). Daraus erzeugt: `matchshot.png` (256), `icons/` (32, 180, 192, 512, maskable 512) |
| Import | `importConfigJSON()` → Auswahl-Dialog, `runImport()` (zusammenführen per Name oder ersetzen; Versionen werden ersetzt) |
| Speicher | Freigestellte Bilder als WebP 95 % (`encodeAlphaCanvas()`, falls das Gerät es kann, sonst PNG; max. 900×1100 wie die Originale), `optimizeStorage()` |
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
