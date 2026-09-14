// Power-Query-Abfragen fuer Wareneingang-Vorlage.xlsx
// ERZEUGT von tools/vorlage_bauen.py — nicht von Hand aendern.
//
// Mac: Daten -> Daten abrufen -> Leere Abfrage, dann
// Erweiterter Editor, alles ersetzen, Abfrage genau so nennen wie
// die Ueberschrift hier. Dreimal, in dieser Reihenfolge — Nummern
// und Liste bauen auf Daten auf.
//
// EINE Zeile ist einzusetzen, und nur im Block «Daten»:
//     Basis = "<Veroeffentlichte-CSV-Adresse>",
//
// Sie kommt aus der Google-Tabelle selbst:
//   Datei -> Im Web veroeffentlichen -> Blatt «Export»
//         -> Kommagetrennte Werte (.csv) -> Veroeffentlichen
//
// NICHT die Apps-Script-Adresse: /exec antwortet mit einer
// Weiterleitung auf eine Adresse, die einmal und kurz gilt, und
// Excel for Mac kommt damit nicht zurecht (404 mitten im Abruf).
// Veroeffentlicht wird nur «Export» — die uebrigen Blaetter,
// darunter «Benutzer», bleiben privat.
// Nummern und Liste bekommen keine Adresse: sie lesen Daten.
//
// ============ Daten ============
let
    Basis = "<Veroeffentlichte-CSV-Adresse>",
    Antwort = Binary.Buffer(Web.Contents(Basis)),
    Quelle = Csv.Document(Antwort,[Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),
    Kopf = Table.PromoteHeaders(Quelle, [PromoteAllScalars=true]),
    Geprueft = if List.Contains(Table.ColumnNames(Kopf), "WeNr") then Kopf
        else error Error.Record("Keine CSV",
            "Die Adresse liefert keine CSV mit der Spalte WeNr. Haeufigste Gruende: die Veroeffentlichung wurde aufgehoben, sie zeigt auf ein anderes Blatt als «Export», oder das Format ist nicht CSV. In der Tabelle: Datei -> Im Web veroeffentlichen -> Blatt «Export» -> Kommagetrennte Werte (CSV).",
            Text.Start(Text.Combine(Table.ColumnNames(Kopf), " | "), 200)),
    Typen = Table.TransformColumnTypes(Geprueft,{{"WeNr", type text}, {"Kunde", type text}, {"Lieferant", type text}, {"LagerM2", type number}, {"KopfBemerkung", type text}, {"AngNam", type text}, {"AngDat", type text}, {"AngZeit", type text}, {"GezNam", type text}, {"GezDat", type text}, {"GezZeit", type text}, {"EinNam", type text}, {"EinDat", type text}, {"EinZeit", type text}, {"Nr", Int64.Type}, {"Artikel", type text}, {"Anzahl", type number}, {"KG", type number}, {"MHD", type text}, {"Regalplatz", type text}, {"Bemerkung", type text}, {"Bestehend", type text}, {"Schluessel", type text}}, "en-US")
in
    Typen

// ============ Nummern ============
let
    Quelle = Daten,
    NurNr = Table.SelectColumns(Quelle,{"WeNr"}),
    Eindeutig = Table.Distinct(NurNr),
    Sortiert = Table.Sort(Eindeutig,{{"WeNr", Order.Descending}})
in
    Sortiert

// ============ Liste ============
let
    Quelle = Daten
in
    Quelle
