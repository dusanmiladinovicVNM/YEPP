// Power-Query-Abfragen fuer Wareneingang-Vorlage.xlsx
// ERZEUGT von tools/vorlage_bauen.py — nicht von Hand aendern.
//
// Mac: Daten -> Daten abrufen -> Leere Abfrage, dann
// Erweiterter Editor, alles ersetzen, Abfrage genau so nennen wie
// die Ueberschrift hier. Dreimal, in dieser Reihenfolge — Nummern
// und Liste bauen auf Daten auf.
//
// Die Adresse unten eintragen: einrichtungPruefen() im Apps Script
// schreibt sie fertig hin.
//
// ============ Daten ============
let
    Quelle = Csv.Document(Web.Contents("<Web-App-URL>?token=<TOKEN_READ>&format=csv&tage=365"),[Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),
    Kopf = Table.PromoteHeaders(Quelle, [PromoteAllScalars=true]),
    Typen = Table.TransformColumnTypes(Kopf,{{"WeNr", type text}, {"Kunde", type text}, {"Lieferant", type text}, {"LagerM2", type number}, {"KopfBemerkung", type text}, {"AngNam", type text}, {"AngDat", type text}, {"AngZeit", type text}, {"GezNam", type text}, {"GezDat", type text}, {"GezZeit", type text}, {"EinNam", type text}, {"EinDat", type text}, {"EinZeit", type text}, {"Nr", Int64.Type}, {"Artikel", type text}, {"Anzahl", type number}, {"KG", type number}, {"MHD", type text}, {"Regalplatz", type text}, {"Bemerkung", type text}, {"Bestehend", type text}, {"Schluessel", type text}}, "en-US")
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
