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

`TOKEN_READ` stoji u **skripteigenschaften** Apps Script projekta, ne u kodu.
Ako ga nemaš pri ruci, pokreni `einrichtungPruefen()` u editoru — ispisuje
gotovu adresu za ovaj upit. Za nov, jak token: `tokenErzeugen()`.

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

## Šablon je već napravljen

```
vorlage/Wareneingang-Vorlage.xlsx   arbeitsmappa: Formular, Daten, Nummern, Liste
vorlage/Abfragen.m                  M-kod oba upita — za Mac, za lepljenje
vorlage/Vorlage-Aufbau.bas          makro koji ih dodaje sam — za Windows
tools/vorlage_bauen.py              generator — odavde su nastali i fajl i M
```

`Abfragen.m` i M u makrou **potiču iz istog generatora**. Nije reč o dve
kopije koje neko treba da drži u koraku.

Broj dokumenta stoji **gore desno u `F1`** (`=IF($J$2="","",$J$2)`), unutar
oblasti štampe — `J2` je van nje, pa bi bez toga potpisan i odložen list
ostao bez oznake kojoj isporuci pripada.

Zaglavlje radi sa spojenim ćelijama, jer je kolona A uska `N°` kolona tabele
pozicija: **A:B** zadatak, **C:D** ime, **E** datum, **F** vreme, a Kunde i
Lieferant **A:B** natpis / **C:F** vrednost. Mejl-verzija (`blattAufbauen` u
`Code.gs`) ima isto to, namerno.

Sve što se moglo unapred: četiri lista, raspored kao na papiru, **85 formula**,
padajuća lista na `J2`, žuta kolona `Bestehend`, oblast štampe `A1:H30` na
jednu stranu. Ništa od toga ne kucaš.

Generator čita `CSV_SPALTEN` **iz `Code.gs`**. Promeni li se endpoint, pokreneš
`python3 tools/vorlage_bauen.py` i šablon je opet u koraku. Zato ovde nema
argumenta „šablon se razilazi sa kodom" — ne pravi se rukom.

Ostaju samo **upiti u samom fajlu**, jer njih Excel mora da upiše sam: Power
Query delovi sklopljeni izvan Excela se često odbiju **bez poruke**, a fajl
koji ćuteći ne radi gori je od jednog ručnog koraka. Sam **tekst** upita je
ipak generisan — vidi `Abfragen.m`.

---

## Postavljanje (~15 min, jednom)

### Windows — makro

1. `Wareneingang-Vorlage.xlsx` otvoriti
2. `Alt+F11` → **Datei → Datei importieren** → `Vorlage-Aufbau.bas`
3. Na vrhu modula upisati `WEB_APP_URL` i `TOKEN`; `TAGE` po potrebi
4. Kursor u `AbfragenAnlegen`, `F5`
5. Prvi put Excel pita za pristup izvoru → **Anonym**, i za nivoe
   privatnosti → **Ignorieren** ili sve na *Öffentlich*
6. **Speichern unter → Excel-Arbeitsmappe mit Makros (\*.xlsm)**
7. U `DieseArbeitsmappe` zalepiti:

```vba
Private Sub Workbook_Open()
    ThisWorkbook.RefreshAll
End Sub
```

Makro pravi oba upita i puni `Daten`, `Nummern` i `Liste`. Sme da se pokrene
više puta — postojeći upiti se zamenjuju, ne dupliraju.

### Mac — M-kod se nalepi

Excel za Mac ne poznaje `Queries.Add`; makro to prijavi i stane. Ali klikanje
kroz čarobnjak nije potrebno — **`vorlage/Abfragen.m` nosi gotov M-kod oba
upita**, i to je isti tekst koji makro upisuje na Windowsu.

```
python3 tools/vorlage_bauen.py   # ako se CSV_SPALTEN promeni
```

Postupak, dvaput (jednom za `Daten`, jednom za `Nummern`):

1. **Daten → Daten abrufen → Leere Abfrage**
2. **Erweiterter Editor** → obriši sve → nalepi odgovarajući blok iz
   `Abfragen.m`
3. u bloku `Daten` zameni `<Web-App-URL>` i `<TOKEN_READ>` —
   **`einrichtungPruefen()`** u Apps Scriptu ispisuje celu adresu gotovu
4. upit nazvati tačno **`Daten`** odnosno **`Nummern`**
5. prvi put pita za pristup izvoru → **Anonym**, i za nivoe privatnosti →
   **Ignorieren** ili sve na *Öffentlich*

Zatim učitati: `Daten` u list **`Daten`** (ćelija `A1`) i još jednom u list
**`Liste`**, a `Nummern` u list **`Nummern`**.

**Zašto nalepiti, a ne kliktati:** upravo koraci sa tipovima su ono što tiho
puca. M-kod tipuje **svaku od 23 kolone izričito**:

| | |
|---|---|
| `Anzahl` `KG` `LagerM2` | `type number`, uz `"en-US"` |
| `Nr` | `Int64.Type` |
| **sve ostalo, uključujući `AngDat`, `AngZeit`, `MHD`** | `type text` |

Bez `"en-US"` „Dezimalzahl" uzima regionalno podešavanje računara — a na
nemačkom je tačka separator hiljada, pa od `3.4` kg tiho postane `34` kg, i
to samo na nekim mašinama. Datumi moraju ostati **tekst**: CSV šalje
`GGGG-MM-TT`, a kao datum učitani se pomeraju po vremenskoj zoni.

Pošto se lista tipova generiše iz `CSV_SPALTEN`, **nova kolona ne može da
ostane netipizovana** — a test `vorlage.py` proverava i da makro i `.m`
tipuju identično, pa Windows i Mac ne mogu da se raziđu.

Na kraju sačuvati kao `.xlsm` i dodati `Workbook_Open` kao gore.

**Bitno pri učitavanju:** u svojstvima upita
*Wenn die Anzahl der Zeilen sich ändert* postaviti na **Zellen überschreiben**,
ne *Zeilen einfügen*. Inače se pri osvežavanju redovi pomeraju.

### Provera odmah

U `J2` izabrati broj iz padajuće liste — obrazac se popuni. Drugi broj →
menja se odmah, bez osvežavanja.

---

## Na SharePoint

Fajl ide u biblioteku. **Ne otvarati ga iz browsera** — Excel for Web ne
osvežava Power Query i to ne javlja; videćeš podatke od pre nedelju dana bez
ijednog upozorenja. Sinhronizuj biblioteku i otvaraj iz Findera.

Tada je jedan klik = otvaranje fajla.

---

## Tri granice, i jedna koja se sama javi

Obrazac ima **10 redova za pozicije** (`POS_ZEILEN`), pretraga ide do
**20000 redova** u listu `Daten` (`DATEN_ZEILEN`), a padajuća lista čita
**1000 brojeva** iz lista `Nummern`. Sve tri su fiksne, i sve tri bi tiho
odsekle ono što preko njih pređe — odštampan list bi izgledao potpuno.

Zato red **`A26`**, odmah ispod tabele i unutar oblasti štampe, nosi crveno
upozorenje. Prazan je dok nema šta da kaže:

| Stanje | Šta piše |
|---|---|
| pozicija ≤ 10 | ništa, red je prazan |
| pozicija > 10 | `Achtung: dieser Wareneingang hat 12 Positionen. Hier stehen nur die ersten 10.` |
| nema nijednog reda | `Zu dieser Nummer stehen keine Zeilen im Blatt Daten — aktualisieren, oder der Suchbereich reicht nicht.` |

Broji ćelija **`J10`** — `COUNTIF` nad istom `WeNr` kolonom koju gađaju i
ostale formule, van oblasti štampe. Test veže granicu u formuli za stvarni
broj redova u obrascu, pa se to dvoje ne može razići.

Treba li više od 10 pozicija po listu: promeni `POS_ZEILEN` u generatoru i
pusti ga ponovo. Upozorenje se preračuna samo.

## Ako treba menjati raspored

Ne u Excelu — u `tools/vorlage_bauen.py`, pa:

```bash
python3 tools/vorlage_bauen.py
python3 tests/vorlage.py
```

Test puni šablon pravim izlazom endpointa i proverava da svaka formula vuče
baš onu kolonu koju treba. Ručna izmena u Excelu preživi do prvog regenerisanja
i ne prolazi kroz taj test.

`POS_ZEILEN` u generatoru je broj redova pozicija (sada 10), `DATEN_ZEILEN`
gornja granica pretrage (sada 20000).

---

## Provera pre predaje

| # | Scenario | Očekivano |
|---|---|---|
| 1 | Otvoriti fajl, pogledati `Daten` | ima redova, zaglavlje `WeNr,Kunde,…` |
| 2 | Izabrati WE-broj u `J2` | obrazac se popuni ceo |
| 3 | Izabrati drugi broj | promeni se odmah, bez osvežavanja |
| 4 | Isporuka sa 2 pozicije | redovi 18–25 prazni, bez `#NV` |
| 5 | Isporuka sa 10 pozicija | svih deset u obrascu, red `A26` prazan |
| 5b | Isporuka sa 12 pozicija | prvih deset, u `A26` crveno upozorenje sa brojem 12 |
| 5c | Broj u `J2` kojeg nema u `Daten` | `A26` javlja da nema redova |
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

**`3.4` postalo `34`** — Power Query je konverziju tipa uradio po regionalnom
podešavanju računara, gde je tačka separator hiljada. Upit `Daten`, korak
`Typen`, mora imati `"en-US"` kao poslednji argument u
`Table.TransformColumnTypes`. Makro ga postavlja; ručno pravljen upit na Macu
traži **Typ ändern → Gebietsschema… → Englisch (USA)**.

**U polju Uhrzeit piše `Sat Dec 30 1899 …`** — kolona `AngZeit`/`GezZeit`/
`EinZeit` u Google tabeli nije formatirana kao tekst, pa je Sheets pretvorio
`08:30` u vreme. Pokreni `setupAnlegen` još jednom; već upisani redovi se
time ne popravljaju.
