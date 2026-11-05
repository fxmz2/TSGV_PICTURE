# Kunden-Handbuch (PDF)

Nicht Teil der App. `handbuch.html` ist die Vorlage, `Match-Shot_Handbuch.pdf` das fertige Handbuch.

Neu erzeugen:
1. Bildschirmfotos der App: `node marketing/handbuch/shots.js` (Test-Zugang „SC Lilaheim“ mit Beispieldaten, nur lokal)
   → schreibt PNGs nach `img/`; danach in JPG umwandeln, z. B.
   `for f in img/*.png; do ffmpeg -y -i "$f" -vf "scale='min(1000,iw)':-2" -q:v 4 "${f%.png}.jpg"; done`
   (Beispielgrafiken stammen aus `landing/*.webp` → als `img/<name>-g.jpg`)
2. PDF: `node marketing/handbuch/pdf.js`

WebP-Bilder vorher immer in JPG umwandeln – sonst bettet Chrome sie unkomprimiert ein (PDF > 10 MB).
