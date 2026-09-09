Attribute VB_Name = "VorlageAufbau"
'==============================================================
' Wareneingang - Abfragen anlegen
'
' Legt die beiden Power-Query-Abfragen an und laedt sie in die
' Blaetter `Daten`, `Nummern` und `Liste` der mitgelieferten
' Vorlage. Danach steht das Formularblatt.
'
' ANWENDUNG
'   1. Wareneingang-Vorlage.xlsx oeffnen
'   2. Alt+F11, diese Datei ueber Datei -> Datei importieren laden
'   3. Unten WEB_APP_URL und TOKEN eintragen
'   4. Cursor in AbfragenAnlegen, F5
'   5. Datei speichern unter -> Excel-Arbeitsmappe mit Makros (*.xlsm)
'   6. Den Dreizeiler unter "WORKBOOK_OPEN" in DieseArbeitsmappe
'      einfuegen, damit sich die Datei beim Oeffnen aktualisiert
'
' Nur unter Windows. Excel fuer Mac kennt Queries.Add nicht; dort
' werden die beiden Abfragen einmalig von Hand angelegt - der Weg
' steht in EXCEL.md. Danach laeuft die Datei auf dem Mac normal,
' Aktualisieren eingeschlossen.
'==============================================================
Option Explicit

' ---- hier eintragen -----------------------------------------
Private Const WEB_APP_URL As String = ""      ' .../exec aus Apps Script
Private Const TOKEN       As String = ""      ' TOKEN_READ aus Code.gs
Private Const TAGE        As Long = 365       ' Fenster; 0 = alles
' -------------------------------------------------------------

Private Const Q_DATEN   As String = "Daten"
Private Const Q_NUMMERN As String = "Nummern"


Public Sub AbfragenAnlegen()
    Dim quelle As String

    If WEB_APP_URL = "" Or TOKEN = "" Then
        MsgBox "Bitte zuerst WEB_APP_URL und TOKEN oben im Modul eintragen.", _
               vbExclamation, "Wareneingang"
        Exit Sub
    End If

    If Not BlaetterDa() Then Exit Sub

    quelle = WEB_APP_URL & "?token=" & TOKEN & "&format=csv"
    If TAGE > 0 Then quelle = quelle & "&tage=" & TAGE

    On Error GoTo Fehler
    Application.ScreenUpdating = False

    AbfrageSetzen Q_DATEN, MDaten(quelle)
    AbfrageSetzen Q_NUMMERN, MNummern()

    ' Beide Blaetter zeigen dieselbe Abfrage; `Liste` ist nur die
    ' sichtbare Fassung fuer die Auswertung.
    InsBlattLaden "Daten", Q_DATEN
    InsBlattLaden "Liste", Q_DATEN
    InsBlattLaden "Nummern", Q_NUMMERN

    Application.ScreenUpdating = True
    MsgBox "Abfragen angelegt und geladen." & vbLf & vbLf & _
           "Jetzt als .xlsm speichern und den Workbook_Open-Dreizeiler " & _
           "in DieseArbeitsmappe einfuegen.", vbInformation, "Wareneingang"
    Exit Sub

Fehler:
    Application.ScreenUpdating = True
    If Err.Number = 438 Or Err.Number = 445 Then
        MsgBox "Diese Excel-Version kennt Queries.Add nicht - " & _
               "vermutlich Excel fuer Mac." & vbLf & _
               "Die beiden Abfragen von Hand anlegen, siehe EXCEL.md.", _
               vbExclamation, "Wareneingang"
    Else
        MsgBox "Fehler " & Err.Number & ": " & Err.Description, _
               vbCritical, "Wareneingang"
    End If
End Sub


'--- M-Code ---------------------------------------------------

' Nur Anzahl, KG, LagerM2 und Nr werden Zahlen. Alles andere bleibt
' Text - vor allem die Datumsspalten: die CSV liefert JJJJ-MM-TT, und
' als Datum eingelesen verschiebt Excel sie ueber die Zeitzone.
Private Function MDaten(ByVal quelle As String) As String
    MDaten = _
        "let" & vbLf & _
        "    Quelle = Csv.Document(Web.Contents(""" & quelle & """)," & _
        "[Delimiter="","", Encoding=65001, QuoteStyle=QuoteStyle.Csv])," & vbLf & _
        "    Kopf = Table.PromoteHeaders(Quelle, [PromoteAllScalars=true])," & vbLf & _
        "    Typen = Table.TransformColumnTypes(Kopf,{" & _
        "{""Anzahl"", type number}, {""KG"", type number}, " & _
        "{""LagerM2"", type number}, {""Nr"", Int64.Type}})" & vbLf & _
        "in" & vbLf & _
        "    Typen"
End Function

' Eindeutige Nummern, neueste zuerst - Quelle der Auswahlliste in J2.
Private Function MNummern() As String
    MNummern = _
        "let" & vbLf & _
        "    Quelle = " & Q_DATEN & "," & vbLf & _
        "    NurNr = Table.SelectColumns(Quelle,{""WeNr""})," & vbLf & _
        "    Eindeutig = Table.Distinct(NurNr)," & vbLf & _
        "    Sortiert = Table.Sort(Eindeutig,{{""WeNr"", Order.Descending}})" & vbLf & _
        "in" & vbLf & _
        "    Sortiert"
End Function


'--- Hilfsmittel ----------------------------------------------

Private Function BlaetterDa() As Boolean
    Dim n As Variant
    For Each n In Array("Formular", "Daten", "Nummern", "Liste")
        If Not BlattDa(CStr(n)) Then
            MsgBox "Blatt '" & n & "' fehlt. Dieses Makro gehoert in " & _
                   "Wareneingang-Vorlage.xlsx.", vbExclamation, "Wareneingang"
            BlaetterDa = False
            Exit Function
        End If
    Next n
    BlaetterDa = True
End Function

Private Function BlattDa(ByVal name As String) As Boolean
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(name)
    On Error GoTo 0
    BlattDa = Not ws Is Nothing
End Function

' Vorhandene Abfrage gleichen Namens ersetzen, damit ein zweiter Lauf
' nicht "Daten (2)" anlegt.
Private Sub AbfrageSetzen(ByVal name As String, ByVal formel As String)
    On Error Resume Next
    ThisWorkbook.Queries(name).Delete
    On Error GoTo 0
    ThisWorkbook.Queries.Add name:=name, Formula:=formel
End Sub

Private Sub InsBlattLaden(ByVal blatt As String, ByVal abfrage As String)
    Dim ws As Worksheet
    Dim lo As ListObject
    Dim i As Long

    Set ws = ThisWorkbook.Worksheets(blatt)

    ' Fruehere Ladung entfernen, sonst haengt eine zweite Tabelle daneben.
    ' Rueckwaerts ueber den Index, nicht For Each: das Loeschen waehrend
    ' der Aufzaehlung ueberspringt Eintraege. Unlink nur versuchen - eine
    ' Tabelle ohne Abfrage wirft dabei.
    For i = ws.ListObjects.Count To 1 Step -1
        Set lo = ws.ListObjects(i)
        On Error Resume Next
        lo.Unlink
        On Error GoTo 0
        lo.Delete
    Next i
    ws.Cells.ClearContents

    Set lo = ws.ListObjects.Add(SourceType:=0, _
        Source:="OLEDB;Provider=Microsoft.Mashup.OleDb.1;" & _
                "Data Source=$Workbook$;Location=" & abfrage & ";" & _
                "Extended Properties=""""", _
        Destination:=ws.Range("$A$1"))

    With lo.QueryTable
        .CommandType = xlCmdSql
        .CommandText = Array("SELECT * FROM [" & abfrage & "]")
        ' Ueberschreiben statt Einfuegen: sonst verschieben sich beim
        ' Aktualisieren die Zeilen und die Formeln zeigen daneben.
        .RefreshStyle = xlOverwriteCells
        .AdjustColumnWidth = False
        .PreserveFormatting = True
        .BackgroundQuery = False
        .Refresh BackgroundQuery:=False
    End With
End Sub


'==============================================================
' WORKBOOK_OPEN - diese drei Zeilen in DieseArbeitsmappe einfuegen,
' nicht hierher. Auf dem Mac ist das Makro der einzige verlaessliche
' Weg; "Aktualisieren beim Oeffnen" in den Abfrageeigenschaften wird
' dort ohne Meldung uebergangen.
'
'   Private Sub Workbook_Open()
'       ThisWorkbook.RefreshAll
'   End Sub
'
'==============================================================
