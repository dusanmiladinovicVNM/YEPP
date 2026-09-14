// Power-Query-Abfragen fuer Wareneingang-Vorlage.xlsx
// ERZEUGT von tools/vorlage_bauen.py — nicht von Hand aendern.
//
// Mac: Daten -> Daten abrufen -> Leere Abfrage, dann
// Erweiterter Editor, alles ersetzen, Abfrage genau so nennen wie
// die Ueberschrift hier. Dreimal, in dieser Reihenfolge — Nummern
// und Liste bauen auf Daten auf.
//
// Zwei Zeilen sind einzusetzen, und nur im Block «Daten»:
//     Basis = "<Web-App-URL>",
//     Token = "<TOKEN_READ>",
// einrichtungPruefen() im Apps Script druckt beide fertig aus.
//
// Die Adresse steht bewusst nicht als ein Stueck mit Fragezeichen
// da: Apps Script leitet /exec auf eine zweite Adresse weiter, die
// einmal und kurz gilt. Power Query merkt sich die aufgeloeste und
// greift ein zweites Mal danach — dann kommt (404) Not Found.
// Nummern und Liste bekommen keine Adresse: sie lesen Daten.
//
// ============ Daten ============
let
    Basis = "<Web-App-URL>",
    Token = "<TOKEN_READ>",
    Antwort = Binary.Buffer(Web.Contents(Basis, [
        Query   = [ token = Token, format = "csv", tage = "365" ],
        IsRetry = true
    ])),
    Quelle = Csv.Document(Antwort,[Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),
    Kopf = Table.PromoteHeaders(Quelle, [PromoteAllScalars=true]),
    Geprueft = if List.Contains(Table.ColumnNames(Kopf), "WeNr") then Kopf
        else error Error.Record("Keine CSV",
            "Die Adresse liefert keine CSV mit der Spalte WeNr. Haeufigster Grund: sie endet auf /dev statt /exec. Die /dev-Adresse verlangt eine Anmeldung, und Power Query bekommt dafuer die Anmeldeseite. Die richtige steht in Apps Script unter Bereitstellen -> Bereitstellungen verwalten, oder fertig bei einrichtungPruefen().",
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
