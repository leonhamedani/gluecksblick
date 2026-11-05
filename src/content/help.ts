export const help = {
  videos:
    'Lege ein oder mehrere Filme dazu, vom selben Planeten, Mond oder derselben Sonne. Du kannst später weitere Dateien ergänzen.',
  images:
    'Fotos einer Serie, einzeln oder viele auf einmal. Auch hier gilt: dasselbe Motiv, damit sie zusammenpassen.',
  beispiel:
    'Lädt eine kleine künstliche Jupiter-Serie. So siehst du den Ablauf, ohne ein eigenes Video zu brauchen.',
  dateiliste:
    'Jede Zeile ist eine Datei, mit Dauer oder dem Vermerk „Bild“. Das Kreuz nimmt nur diese Datei wieder heraus.',
  motiv:
    'Planet sucht eine helle Scheibe vor dunklem Himmel und schneidet sie frei. Mond oder Sonne füllt das Bild, deshalb bleibt ein Ausschnitt in der Mitte.',
  verfolgen:
    'Großer Zoom behält nur den einen Abschnitt, in dem die Scheibe am größten und ähnlich groß ist. Bei mehreren Videos bleibt oft nur ein einziges übrig, die anderen werden absichtlich ausgelassen. Gleich groß nimmt brauchbare Bilder aus allen Videos und zieht sie auf dieselbe Scheibengröße, am besten für mehrere Clips. Alles nimmt vollständige Scheiben aus allen Videos, auch wenn die Größe unterschiedlich ist.',
  maxFrames:
    'So viele Bilder liest das Programm pro Video. Mehr kann feiner werden, dauert aber länger und braucht mehr Speicher.',
  longEdge:
    'Die längste Seite des Ergebnisses in Bildpunkten. Eine kleinere Kante ist schonender für den Speicher des Handys.',
  crop:
    'Schneidet von allen Seiten in die Mitte. Hundert Prozent ist das ganze Bild. Nur für Mond und Sonne, nicht für die Planetensuche.',
  trimStart:
    'Der Anfang jedes Films. Schiebe ihn nach hinten, wenn das Motiv erst später ins Bild kommt.',
  trimEnd:
    'Das Ende jedes Films. Kürze ihn, wenn das Motiv am Schluss aus dem Bild läuft oder das Bild schwarz wird.',
  auswerten:
    'Startet das Lesen. Jede Datei kommt einzeln dran. Was der Browser nicht öffnen kann, wird übersprungen, der Rest läuft weiter.',
  qualitaet:
    'Der Balken zeigt, wie ruhig jedes Bild ist. Der Regler behält nur die schärfsten Prozent. Messing bleibt, Oliv fällt weg.',
  weiter:
    'Als Nächstes werden die behaltenen Bilder deckungsgleich übereinander gelegt.',
  referenz:
    'Die Vorlage, an der sich die anderen Bilder ausrichten. Entweder das schärfste Einzelbild oder ein ruhiges Mittel aus den besten.',
  lokal:
    'Luftflimmern verrückt kleine Stellen unterschiedlich. Ein Raster gleicht das Stück für Stück aus, nicht nur das ganze Bild auf einmal.',
  raster:
    'Mehr Punkte folgen dem Flimmern genauer und brauchen etwas länger.',
  kachel:
    'Die Umgebung um jeden Punkt. Größer ist stabiler, kleiner reagiert auf feinere Verzerrungen.',
  punktWert:
    'Punkte ohne klares Muster, etwa der schwarze Himmel neben der Scheibe, werden ausgelassen.',
  korrelation:
    'Wie ähnlich ein Bild der Vorlage sein muss. Darunter wird es nicht mitgestapelt.',
  stapelArt:
    'Mittelwert rechnet alle Bilder zusammen. Sigma-Clip lässt einzelne Ausreißer weg, zum Beispiel einen hellen Störfleck.',
  sigma:
    'Wie streng Ausreißer entfernt werden. Ein höherer Wert ist nachsichtiger und behält mehr.',
  stapeln:
    'Legt die ausgewählten Bilder zu einem Bild übereinander. Das kann einen Moment dauern.',
  vergleich:
    'Schärfstes Bild zeigt nur das beste Einzelbild. Stapel zeigt das zusammengebaute Ergebnis, damit du den Unterschied siehst.',
  wellenFein:
    'Hebt die feinsten Details an, etwa Ringe oder kleine Krater. Null lässt diese Stufe aus.',
  wellenMittel:
    'Hebt mittlere Details an, größer als das feinste Rauschen und kleiner als die ganze Scheibe.',
  wellenGrob:
    'Hebt die großen Formen an. Gut für weiche Übergänge, nicht für das feinste Korn.',
  unscharf:
    'Zieht Kanten nach: vom Bild wird ein weiches Abbild abgezogen. Mehr wirkt kräftiger, kann aber Rauschen betonen.',
  radius:
    'Wie breit die weiche Vorlage ist. Klein betont feine Kanten, groß die größeren Formen.',
  helligkeit:
    'Macht das ganze Bild heller oder dunkler, ohne die Farben zu tauschen.',
  kontrast:
    'Zieht helle und dunkle Stellen auseinander. Mehr lässt das Motiv kräftiger vor dem Himmel stehen.',
  gamma:
    'Biegt die Mitteltöne. Unter 1 werden Schatten heller, über 1 wird das Bild insgesamt dunkler.',
  saettigung:
    'Macht die Farben kräftiger oder grauer, ohne die Helligkeit zu ändern. Etwas über 1 holt das blasse Gelb nach dem Stapeln zurück.',
  png: 'Speichert das sichtbare Bild als PNG, ein übliches Format für Fotos und zum Teilen.',
  tiff: 'Speichert mehr Helligkeitsstufen fürs spätere Bearbeiten. Nicht jede App öffnet so ein 16-bit-TIFF.',
  teilen: 'Öffnet das Teilen-Menü des Telefons, zum Beispiel für Nachrichten oder die Fotos-App.',
  andere: 'Geht zurück zur Dateiliste. Du kannst Dateien ändern und danach neu auswerten.',
  abbrechen: 'Stoppt das Lesen oder Rechnen. Nichts wird dabei von der Liste gelöscht.',
} as const
