# Glücksblick

Glücksblick stapelt Planeten-, Mond- und Sonnenaufnahmen im Browser. Das Verfahren ist Lucky Imaging: aus einem verwackelten Video oder einer Bilderserie bleiben nur die schärfsten Momente, sie werden zur Deckung gebracht und zu einem Bild verrechnet.

Die Rechnung läuft vollständig auf dem Gerät. Es gibt kein Backend, und es wird nichts hochgeladen. Die Oberfläche ist auf Deutsch und für das Telefon gebaut. Die fertige Seite ist eine statische PWA und lässt sich auf GitHub Pages ausliefern, auch in einem Unterordner wie `/repo-name/`.

Das Programm ist eigenständig. Es orientiert sich an der Idee bekannter Lucky-Imaging-Programme, übernimmt aber weder deren Code noch deren Namen oder Erscheinungsbild.

## Bedienung

1. **Aufnahme.** Mehrere Videos (MP4, MOV, WebM) und Bilder (JPEG, PNG, WebP) derselben Scheibe wählen. Dateien lassen sich nacheinander hinzufügen und einzeln wieder entfernen. Alternativ lädt „Beispiel: Jupiter mit Seeing“ eine künstliche Sequenz.
2. **Grenzen setzen.** „Bilder auswerten“ gilt pro Video. „Lange Kante“ begrenzt die Auflösung. Anfang und Ende schneiden jedes Video zeitlich zu. Bei „Planet“ sucht das Programm die Scheibe in jeder Datei, verwirft leere oder angeschnittene Bilder und schneidet ein Fenster um sie herum. „Großer Zoom“ behält nur den größten ähnlichen Abschnitt, oft aus einem einzigen Video, die anderen werden absichtlich ausgelassen. „Gleich groß“ nimmt brauchbare Bilder aus allen Videos und zieht sie auf dieselbe Scheibengröße. „Alles“ nimmt jede vollständige Scheibe aus allen Videos, auch bei unterschiedlicher Größe. Kann eine Datei nicht gelesen werden, wird sie übersprungen, solange eine andere brauchbar ist. Kommt aus keiner Datei ein Bild an, meldet das Programm einen Lesefehler statt eines fehlenden Planeten. Beim Mond bleibt der feste Mittenausschnitt.
3. **Schärfe.** Jedes Bild bekommt die Varianz des Laplace-Filters, gemessen auf einer Graustufe nach einem leichten Weichzeichner. Der Regler behält die besten Prozent. Messingfarbene Balken bleiben, olivfarbene fallen weg.
4. **Deckung.** Eine globale Verschiebung wird per Phasenkorrelation (FFT, mit Subpixel) bestimmt. Bei „Planet“ wird die Scheibe vorher über den Schwerpunkt zentriert. „Mittel der besten“ bildet aus den schärfsten, bereits grob ausgerichteten Bildern eine Referenz und richtet danach erneut aus. Lokale Punkte legen ein Raster über das Motiv; jede Kachel bekommt eine eigene Verschiebung, und die Verschiebungen gehen mit Abstand gewichtet ineinander über.
5. **Stapel.** Mittelwert oder Sigma-Clipping in Fließkomma, Farbe bleibt erhalten. Bilder mit zu schwacher Korrelation werden ausgelassen.
6. **Schliff.** Wavelet-artige Schärfung in drei Skalen, Unscharfmaskierung, Helligkeit, Kontrast, Gamma und Sättigung. Die Vorschau folgt den Reglern. „Schärfstes Bild“ und „Stapel“ lassen sich direkt vergleichen.
7. **Sichern.** PNG, unkomprimiertes 16-bit-RGB-TIFF, oder Teilen über die Web Share API.

Neben jedem Bedienelement sitzt ein kleines **i**. Es öffnet eine kurze Erklärung. „Verstanden“, Escape oder ein Tipp daneben schließt sie. Der Knopf bleibt und lässt sich jederzeit wieder öffnen.

Abbrechen stoppt das Lesen und die Hintergrundrechnung. Während der Arbeit bleibt der Bildschirm nach Möglichkeit an.

### Auf dem Home-Bildschirm

- Android: im Browser „Installieren“ oder „Zum Startbildschirm hinzufügen“.
- iPhone: Teilen, dann „Zum Home-Bildschirm“.

Danach startet Glücksblick ohne Adressleiste und kann die zuletzt geladene Version auch ohne Netz öffnen. Die Videos selbst bleiben auf dem Telefon und werden nicht mit der App gespeichert.

## Grenzen

- Der Browser sucht im Video über die Abspielposition. Das ist nicht immer bildgenau, besonders bei manchen Handy-Codecs. Eine Bilderserie ist exakter.
- HEIC wird nicht gelesen.
- Es gibt kein Drizzle und keine Derotation. Große Mondmosaike sind nicht das Ziel; der Ausschnitt soll in den Speicher passen.
- Sigma-Clipping braucht die ausgewählten Bilder gleichzeitig. Wird das zu viel, fällt das Programm auf den Mittelwert zurück und sagt das.
- WebGL beschleunigt das Verziehen, wenn es pixelgenau zur CPU-Variante passt. Sonst rechnet der Prozessor. WebGPU ist nicht nötig.

## Entwicklung

Voraussetzung ist Node.js 22.

```bash
npm install
npm test
npm run dev
```

Die Entwicklungsumgebung liegt auf [http://127.0.0.1:43123](http://127.0.0.1:43123).

```bash
npm run build
```

Der statische Stand liegt danach in `dist/`. Diesen Ordner auf GitHub Pages veröffentlichen (als Artifact des Workflows `.github/workflows/pages.yml` oder, nach dem Build, den Inhalt von `dist/` in den Pages-Zweig). Pfade sind relativ (`base: './'`), damit die Seite unter `/repo-name/` funktioniert. Manifest und Service Worker werden beim Build erzeugt.

`npm test` prüft ohne Browser:

- die Phasenkorrelation findet bekannte Verschiebungen, auch unterhalb eines Pixels
- eine synthetische Jupiter-Sequenz (verschoben, unterschiedlich unscharf, mit etwas Rauschen) wird nach Ausrichtung und Stapeln deutlich schärfer als das unausgerichtete Mittel derselben Bilder
- lokale Punkte verderben eine reine Verschiebung nicht und trennen zwei Bildhälften mit unterschiedlicher Verschiebung
- Sigma-Clipping entfernt ein helles Ausreißerfeld
- das TIFF trägt den richtigen Kopf und 16-bit-Proben

Die Schärfe wird dabei als Laplace-Varianz der Helligkeit gemessen, vor jedem Schliff.
