# Excel na SharePointu — jedan klik

Dva puta do Excela, i to nisu isti posao:

| | **Šablon na SharePointu** | **Als Excel senden** |
|---|---|---|
| Smer | Excel **povlači** (Power Query) | aplikacija **gura** (mejl + Drive) |
| Stanje | uvek trenutno, na svako otvaranje | zamrznut snimak trenutka slanja |
| Šta daje | obrazac **i** zbirnu listu, u jednom fajlu | jedan `.xlsx` po dokumentu |
| Čemu služi | interni rad, štampa, evidencija | slanje napolje — kupcu, dobavljaču, u arhivu |

Ovaj fajl opisuje **prvi** put. To je mehanizam iz Spesena: `.xlsm` leži u
SharePoint biblioteci, Power Query anonimno povlači CSV sa Apps Script URL-a,
`Workbook_Open` osvežava pri otvaranju. Aplikacija ne pristupa SharePointu
nikad — nema registracije aplikacije, nema Azure-a, nema dozvola za mučenje.

---

## Razlika u odnosu na Spesen

Spesenov Excel je ravna zbirna tabela — Power Query je učita i posao je gotov.

Wareneingang je **obrazac po dokumentu**: zaglavlje plus n pozicija, jedan A4
list po isporuci. Power Query ne može da vrati obrazac, samo tabelu. Zato
arbeitsmappa ima tri lista:

```
Daten      skriven   Power Query ga puni; ništa se ručno ne dira
Nummern    skriven   jedinstveni WE-brojevi za padajuću listu
Formular   vidljiv   obrazac kao na papiru, puni se formulama
Liste      vidljiv   zbirna evidencija, obična tabela
```

Prebacivanje sa dokumenta na dokument = **promena u padajućoj listi**.
Bez ponovnog osvežavanja, bez čekanja.

---

## CSV — zamrznut ugovor

```
<Web-App-URL>?token=<TOKEN_READ>&format=csv
```

Jedan red po poziciji; podaci zaglavlja se ponavljaju u svakom redu.
Stornirani ispadaju. **23 kolone, fiksni redosled:**

| Kol. | Ime | Šta je |
|---|---|---|
| A | `WeNr` | broj wareneinganga |
| B | `Kunde` | |
| C | `Lieferant` | |
| D | `LagerM2` | |
| E | `KopfBemerkung` | napomena za celu isporuku |
| F G H | `AngNam` `AngDat` `AngZeit` | Angenommen / Accepted |
| I J K | `GezNam` `GezDat` `GezZeit` | Gezählt & kontrolliert |
| L M N | `EinNam` `EinDat` `EinZeit` | Eingelagert / stored |
| O | `Nr` | redni broj pozicije |
| P | `Artikel` | |
| Q | `Anzahl` | |
| R | `KG` | |
| S | `MHD` | |
| T | `Regalplatz` | |
| U | `Bemerkung` | napomena pozicije |
| V | `Bestehend` | `X` ili prazno |
| W | `Schluessel` | `WeNr-Nr` — na njemu stoje formule pozicija |

**Ovih 23 kolone se ne pomeraju.** Nova kolona u listu `Wareneingang` ili
`Positionen` ne stiže ovde sama; ko je treba, dodaje je u `CSV_SPALTEN`
u `Code.gs` **na kraj**, nikad između. Inače pukne svaka formula desno od
umetnute kolone, i to tiho.

Dva neobavezna parametra:

| | |
|---|---|
| `&tage=365` | samo poslednjih n dana — drži arbeitsmappu malom |
| `&we=WE-2026-0006` | samo taj jedan wareneingang |

`&we=` ovde ne treba: šablon povlači sve i bira padajućom listom. Postoji za
slučaj da nekome zatreba jedan dokument bez Excela.

---

## Postavljanje (~45 min, jednom)

### 1. Provera URL-a

Zalepi u browser:

```
<Web-App-URL>?token=<TOKEN_READ>&format=csv&tage=365
```

Mora vratiti CSV koji počinje sa `WeNr,Kunde,Lieferant,...`. Ako vidiš Google
login stranicu, `Zugriff` u Bereitstellung nije na *Jeder*.

### 2. Upit `Daten`

**Daten → Aus dem Web** → gornji URL → autentifikacija **Anonym**.

U Power Query editoru:
- **Erste Zeile als Überschriften verwenden**
- tipove kolona ostavi kao **Text** — datumi su već `GGGG-MM-TT` i kao tekst
  se ne pomeraju po vremenskoj zoni. `Anzahl`, `KG` i `LagerM2` postavi na
  **Dezimalzahl**.
- upit preimenuj u **`Daten`**
- **Schliessen & laden in… → Neues Arbeitsblatt**, list nazovi `Daten`

### 3. Upit `Nummern` za padajuću listu

Desni klik na upit `Daten` → **Duplizieren**. U duplikatu:
- **Andere Spalten entfernen** osim `WeNr`
- **Duplikate entfernen**
- Sortieren absteigend
- preimenuj u **`Nummern`**, učitaj u novi list `Nummern`

### 4. List `Formular`

Nov list, raspored **isti kao na papiru** — i isti kao `.xlsx` koji stiže
mejlom, da se ne razlikuju:

| Ćelija | Sadržaj |
|---|---|
| `A1` | `Wareneingang / Material reception` |
| `A3:D3` | `Aufgabe / Task` · `Name Mitarbeiter / Employee name` · `Datum / Date` · `Uhrzeit / Time` |
| `A4` `A5` `A6` | `Angenommen / Accepted` · `Gezählt & kontrolliert` · `Eingelagert / stored` |
| `A8` | `Artikelanzahl bitte direkt auf dem Lieferschein abhaken bzw. anpassen.` |
| `A10` `A11` | `Kunde / Client` · `Lieferant / Supplier` |
| `A13` | `Bei neuem und bestehendem Material mit oder ohne Lieferschein notwendig:` |
| `A15:H15` | zaglavlje pozicija, osam kolona kao na papiru |
| `A16:A25` | brojevi `1` do `10`, ukucani |
| `A27` `A28` | `Lagerfläche / storage space` · `m2 Anzahl / m2 quantity` |
| `D27` `D28` | `Umrechung/Conversion` · `1 g = 0.001 kg` |

**Biranje dokumenta** — van oblasti štampe:

- `J1`: tekst `Wareneingang wählen`
- `J2`: **Daten → Datenüberprüfung → Liste**, izvor `=Nummern!$A$2:$A$1000`

### 5. Formule

Zaglavlje — traži prvi red tog WE-broja:

```excel
B4  =WENNFEHLER(INDEX(Daten!F:F;VERGLEICH($J$2;Daten!$A:$A;0));"")
C4  =WENNFEHLER(INDEX(Daten!G:G;VERGLEICH($J$2;Daten!$A:$A;0));"")
D4  =WENNFEHLER(INDEX(Daten!H:H;VERGLEICH($J$2;Daten!$A:$A;0));"")

B5  … Daten!I:I      C5  … Daten!J:J      D5  … Daten!K:K
B6  … Daten!L:L      C6  … Daten!M:M      D6  … Daten!N:N

B10 =WENNFEHLER(INDEX(Daten!B:B;VERGLEICH($J$2;Daten!$A:$A;0));"")
B11 =WENNFEHLER(INDEX(Daten!C:C;VERGLEICH($J$2;Daten!$A:$A;0));"")
C28 =WENNFEHLER(INDEX(Daten!D:D;VERGLEICH($J$2;Daten!$A:$A;0));"")
```

Pozicije — ključ `WeNr-Nr` iz kolone `W`:

```excel
B16 =WENNFEHLER(INDEX(Daten!P:P;VERGLEICH($J$2&"-"&$A16;Daten!$W:$W;0));"")
C16 … Daten!Q:Q      D16 … Daten!R:R      E16 … Daten!S:S
F16 … Daten!T:T      G16 … Daten!U:U      H16 … Daten!V:V
```

`B16:H16` povuci naniže do reda **25**. Deset redova pokriva veće isporuke;
prazni ostaju prazni jer `WENNFEHLER` guta `#NV`.

Engleski Excel: `WENNFEHLER` = `IFERROR`, `VERGLEICH` = `MATCH`,
`INDEX` = `INDEX`.

### 6. Izgled i štampa

- `H15:H25` — pozadina **žuta**, kao kolona `Bestehend` na papiru
- okviri oko `A3:D6`, `A10:B11`, `A15:H25`, `A27:D28`
- **Seitenlayout → Druckbereich festlegen** = `A1:H28`
- **Skalierung → Auf eine Seite anpassen**

Kolona `J` je van oblasti štampe, pa se padajuća lista ne štampa.

### 7. List `Liste`

Za evidenciju preko svih isporuka: prevuci upit `Daten` još jednom na nov list
i uključi **Als Tabelle formatieren** sa filterima. Ovde se ništa ne računa —
to je ista tabela, samo vidljiva.

### 8. Automatsko osvežavanje

Sačuvaj kao **`.xlsm`**. `Alt+F11` → `DieseArbeitsmappe`:

```vba
Private Sub Workbook_Open()
    ThisWorkbook.RefreshAll
End Sub
```

Na Macu je makro jedini pouzdan način; *Aktualisieren beim Öffnen* u
svojstvima upita tamo ume da se preskoči bez poruke.

### 9. Na SharePoint

Fajl ide u biblioteku. **Ne otvarati ga iz browsera** — Excel for Web ne
osvežava Power Query i to ne javlja; videćeš podatke od pre nedelju dana bez
ijednog upozorenja. Sinhronizuj biblioteku i otvaraj iz Findera.

Tada je jedan klik = otvaranje fajla. Podaci su trenutni, obrazac se bira
padajućom listom, štampa staje na jednu stranu.

---

## Provera pre predaje

| # | Scenario | Očekivano |
|---|---|---|
| 1 | Otvoriti fajl, pogledati `Daten` | ima redova, zaglavlje `WeNr,Kunde,…` |
| 2 | Izabrati WE-broj u `J2` | obrazac se popuni ceo |
| 3 | Izabrati drugi broj | promeni se odmah, bez osvežavanja |
| 4 | Isporuka sa 2 pozicije | redovi 18–25 prazni, bez `#NV` |
| 5 | Isporuka sa 10 pozicija | svih deset u obrascu |
| 6 | Nekvitiran korak | to polje prazno, ostalo popunjeno |
| 7 | Kunde sa zarezom u imenu | jedno polje, ne razbijeno na dva |
| 8 | Novi unos u PWA, pa zatvoriti i otvoriti fajl | novi broj u padajućoj listi |
| 9 | Storniran unos | nestao iz `Daten` i iz padajuće liste |
| 10 | Štampa | jedna strana, žuta kolona `Bestehend`, bez kolone `J` |

Tačke 4 i 7 su one koje pucaju tiho — proveri ih pažljivo.

---

## Kad nešto ne radi

**`#NV` umesto praznog** — negde nedostaje `WENNFEHLER`.

**Obrazac ostane prazan** — `J2` sadrži broj kojeg nema u `Daten`. Proveri da
`&tage=` ne odseca baš taj dokument.

**Pozicije se pomešale između dokumenata** — formula pozicija gleda u
`Daten!$A:$A` umesto u `Daten!$W:$W`. Ključ je `WeNr-Nr`, ne `WeNr`.

**Datum se pomerio za dan** — kolona je u Power Query postavljena na `Datum`
umesto na `Text`. CSV isporučuje `GGGG-MM-TT` i to treba da ostane tekst.

**Osvežavanje traži prijavu** — pri prvom pozivu je izabran pogrešan način
autentifikacije. **Daten → Abfragen und Verbindungen → Datenquelleneinstellungen
→ Berechtigungen bearbeiten** → **Anonym**.

**Podaci stari** — fajl je otvoren iz browsera. Vidi korak 9.

**Kolone se pomerile posle izmene koda** — neko je umetnuo kolonu u
`CSV_SPALTEN` između postojećih. Vrati je na kraj.
