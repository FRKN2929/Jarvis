# JARVIS fürs iPhone – Installation ohne Mac

JARVIS ist eine Web-App für den Home-Bildschirm. Damit das Gehirn, der Offline-Modus und das Mikrofon funktionieren, braucht Safari eine **HTTPS-Adresse**. GitHub Pages stellt sie kostenlos und dauerhaft bereit. Alles lässt sich vom iPhone aus erledigen.

## 1. Dateien entpacken
Öffne `JARVIS-iPhone.zip` in der **Dateien**-App und tippe einmal darauf. Es entsteht ein Ordner `JARVIS-iPhone` mit 14 Dateien.

## 2. GitHub-Konto und Repository
1. Öffne **github.com** in Safari und erstelle ein kostenloses Konto (falls du keins hast).
2. Tippe oben auf **+ › New repository**.
3. Gib als Name `jarvis` ein, wähle **Public** und tippe auf **Create repository**.

## 3. Dateien hochladen
1. Tippe im neuen Repository auf **uploading an existing file**. Alternativ: **Add file › Upload files**.
2. Tippe auf **choose your files**, wähle in Dateien den Ordner `JARVIS-iPhone`, markiere **alle Dateien** und tippe auf **Öffnen**.
3. Warte, bis alle Dateien aufgelistet sind, und tippe unten auf **Commit changes**.

## 4. GitHub Pages einschalten
1. Öffne im Repository **Settings › Pages**. Auf dem iPhone sind die Settings eventuell erst nach Wischen im Menü zu sehen.
2. Wähle unter **Branch** `main` und `/ (root)`, dann **Save**.
3. Nach 1–2 Minuten steht oben: *Your site is live at* `https://DEINNAME.github.io/jarvis/`

## 5. Auf den Home-Bildschirm
1. Öffne `https://DEINNAME.github.io/jarvis/` in **Safari**.
2. Tippe auf **Teilen › Zum Home-Bildschirm › Hinzufügen**.
3. Öffne JARVIS **vom Home-Bildschirm** (nicht in Safari) und tippe auf **„Jetzt laden“**. Bleib dabei im WLAN, der Download dauert einige Minuten.
4. Fertig. Das Modell bleibt auf dem iPhone gespeichert. Ab jetzt startet JARVIS in Sekunden, Gespräche gehen auch offline.

## Beispiele
- „Erstelle eine Präsentation über Elektroautos“
- „Schreib ein PDF über gesunde Ernährung“ / „… als Word“
- „Erstelle eine Excel Tabelle mit meinen Monatsausgaben“
- „Bau mir eine Website für mein Café Morgenrot“
- „Mach mir ein TikTok Video über Kaffee-Fakten“, danach **Teilen → TikTok**
- „Zeig mir Krypto“, „Analyse Bitcoin“, „Wie steht der DAX?“
- „Wie wird das Wetter?“, „Was passiert in der Welt?“, „Merke dir, dass ich Kaffee schwarz trinke“

## Aktualisieren
Neue Dateien einfach erneut über **Add file › Upload files** hochladen. Gleichnamige Dateien werden ersetzt. Die App holt sich die neue Version beim nächsten Öffnen.

## Wenn etwas nicht geht
- **„Kein WebGPU – CPU-Modus“:** iOS auf Version 26 aktualisieren. Bis dahin läuft das Gehirn langsamer auf der CPU.
- **Download bricht ab:** In den Einstellungen das Modell „Schnell“ wählen oder Speicherplatz freigeben (1–3 GB nötig).
- **Mikrofon-Knopf reagiert nicht:** In iOS-Einstellungen › Safari › Mikrofon erlauben. Alternativ das Diktier-Mikrofon der Tastatur benutzen.
- **Aktienkurse gehen nicht:** Yahoo blockiert Browser-Abfragen zeitweise. Krypto funktioniert trotzdem.
