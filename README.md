# Wareneingang

Kompletno rešenje: PWA → Google Sheets → Excel šablon na SharePointu.
Bez Microsoft licenci, bez Azure-a, bez SharePoint API-ja.

```
PWA  →  Apps Script Web-App  →  Google Sheets  →  CSV  →  Excel .xlsm
                                               →  .xlsx  →  mejl + Drive
```

**Excel povlači, aplikacija ne gura.** `.xlsm` leži u SharePoint biblioteci i
Power Query ga puni sa Apps Script URL-a; jedan klik = otvaranje fajla.
Aplikacija ne pristupa SharePointu nikad. Detaljno u **`EXCEL.md`**.

Drugi, sporedni put je **Als Excel senden**: zamrznut `.xlsx` po dokumentu,
mejlom i u Drive arhivu — za slanje napolje, kupcu ili dobavljaču.

Sheets nikada nije javan. Sve ide kroz Apps Script, koji proverava sesiju.
Identitet dolazi iz sesije, ne iz zahteva — radnik ne može kvitirati
preuzimanje pod tuđim imenom.

Papirni obrazac ima tri potpisa: *Angenommen*, *Gezählt & kontrolliert*,
*Eingelagert*. Svaki od njih po pravilu radi drugi čovek u drugom trenutku.
Aplikacija to preslikava: ko kvitira, njegovo ime i serversko vreme se upisuju.

---

## Datoteke

```
index.html                 CIJELA aplikacija: CSS, HTML, logika, konfiguracija, logo
manifest.webmanifest       ime i ikone za dodavanje na home screen
icons/icon-192.png         ikone za home screen, iste kao u Spesenu
icons/icon-512.png
icons/icon-maskable-512.png

apps-script/Code.gs        ceo backend — prijava, unos, kvitiranje, xlsx, CSV

vorlage/Wareneingang-Vorlage.xlsx   gotova Excel šablona za SharePoint
vorlage/Vorlage-Aufbau.bas          makro koji joj doda Power Query upite
tools/vorlage_bauen.py              generator šablone iz CSV_SPALTEN

tests/pwa.mjs              vozi pravi UI u Chromiumu sa lažnim backendom
tests/backend.mjs          vozi Code.gs nad Sheets-om u memoriji
tests/vorlage.py           računa formule šablone nad pravim CSV-om
tests/gerippe.mjs          Sheets u memoriji, deljen između testova

README.md                  ovaj fajl
EXCEL.md                   šablon na SharePointu, Power Query, formule
Wareneingang - Kurzanleitung.md   uputstvo za radnike, na nemačkom
```

Sve što se menja nalazi se u `index.html`, u tri označena bloka:

| Blok | Šta je unutra |
|---|---|
| `:root` u `<style>` | boje; akcentna je maslinasta `#8FA426`, kao u Spesenu |
| `<symbol id="logo">` | wordmark; `#logo-zeichen` je isti crtež, samo isečen |
| `const CONFIG` | Web-App-URL iz Apps Scripta |

**Izgled je isti kao u Spesenu** — ista maslinasta `#8FA426`, isti wordmark,
iste ikone, isti razmaci. Jedina namerna razlika je žuta `--gelb`: ona nije
kućna boja nego žuta kolona `Bestehend` sa papira, i u izvezenom Excelu stoji
isto tako. Zato je nose samo ta kućica i njena oznaka.

Jedna sitnica je usput ispravljena, ne prepisana: u Spesenu `.sekundaer`
gubi od `button.gross` po specifičnosti, pa sporedna dugmad tamo nemaju
okvir i izgledaju kao goli tekst. Ovde pravilo stoji kao `.gross`, pa okvir
zaista i postoji. Ako hoćeš da budu identična do piksela, isto se popravlja
i u Spesenu — jedna reč.

**Bez ijednog spoljnog zahteva.** Stranica ne povlači font sa
`fonts.googleapis.com` — taj zahtev je blokirao prvi prikaz baš tamo gde je
mreža slaba. Ako je Open Sans na uređaju, koristi se; inače sistemski font,
što je na iPadu ionako prirodniji izgled.

**Bez service workera.** Aplikacija ionako traži mrežu za svaku radnju,
pa keš donosi samo problem zastarele verzije. Bez njega je izmena vidljiva
odmah po otpremanju, bez podizanja verzije keša i bez tvrdog osvežavanja
kod korisnika. Ikona na home screenu radi i ovako — na iPadu je nose
`apple-mobile-web-app-*` meta oznake, na Androidu manifest.

---

## Faza 1 — Google Sheets (~5 min)

Nova prazna tabela. Zapiši ID iz URL-a, deo između `/d/` i `/edit`.

Listove **ne praviš ručno** — to radi `setupAnlegen()` u Fazi 2.
Nastaju ovi, sa ovim kolonama:

| List | Kolone |
|---|---|
| `Wareneingang` | `WeNr` `Zeitstempel` `Erfasser` `Email` `Kunde` `Lieferant` `AngNam` `AngDat` `AngZeit` `GezNam` `GezDat` `GezZeit` `EinNam` `EinDat` `EinZeit` `LagerM2` `Bemerkung` `Storniert` `Status` `FotoUrl` `DateiUrl` `Gesendet` `Vorgang` |
| `Positionen` | `WeNr` `Nr` `Artikel` `Anzahl` `KG` `MHD` `Regalplatz` `Bemerkung` `Bestehend` `FotoUrl` |
| `Kunden` | `Name` `Aktiv` `Sortierung` `EmailHaupt` `EmailVertretung` |
| `Kontakte` | `Name` `Email` `Aktiv` |
| `Lieferanten` | `Name` `Aktiv` `Sortierung` |
| `Benutzer` | `Email` `Name` `PassHash` `Salt` `Aktiv` `Fehler` `GesperrtBis` `LetzterLogin` `PwGeaendert` `Rolle` |
| `Sessions` | `Token` `Email` `GueltigBis` |
| `Parameter` | `Schluessel` `Wert` `GueltigAb` |

**Kod čita kolone po imenu, ne po poziciji.** Redosled u tabeli smeš da
menjaš, kolone smeš da dodaješ na kraj — ništa se ne lomi. Imena su izvor
istine; njih ne diraj.

Popuni `Kunden` i `Lieferanten`. `Aktiv` upisuj kao `true`.
`Sortierung` ostavi sa rupama (10, 20, 30) da kasnije možeš ubaciti nešto
između. Obe liste su samo predlog u formularu — radnik sme upisati i ime
koje nije na listi, jer novi dobavljač ne sme da čeka na admina.

## Faza 2 — Apps Script (~30 min)

**Erweiterungen → Apps Script** iz same tabele.

1. Obriši sadržaj i zalepi `apps-script/Code.gs`
2. **Projekteinstellungen → Skripteigenschaften** → tri reda:

   | Ime | Vrednost |
   |---|---|
   | `SHEET_ID` | ID tabele, iz URL-a između `/d/` i `/edit` — sme i cela adresa |
   | `PWA_URL` | adresa PWA, ide u pristupne mejlove |
   | `TOKEN_READ` | štiti CSV izlaz — ili pokreni `tokenErzeugen()` |

   Zatim u editoru levo **Services `+` → Google Sheets API** (identifier
   `Sheets`). Bez njega aplikacija radi, samo sporije — čitanje tada ide
   preko `SpreadsheetApp`. Vidi **Brzina**.

3. Pokreni **`setupAnlegen`** jednom — pravi listove, zaglavlja i tri
   Drive foldera pored tabele
4. **Bereitstellen → Neue Bereitstellung → Web-App**
   *Ausführen als: Ich*, *Zugriff: Jeder*
5. Prvi put traži odobrenje za tabelu, Drive i slanje pošte — potvrdi
6. Zapiši **Web-App-URL**

**U kodu nema nijedne od te tri vrednosti** — stoje u skripteigenschaften.
To znači da se kod sme **ceo zameniti** kad stigne nova verzija, bez ponovnog
unošenja ijednog polja; i da javni repo ne nosi token.

Dve pomoćne funkcije za editor:

| Funkcija | Šta radi |
|---|---|
| `einrichtungPruefen()` | javlja koja vrednost fali, da li se tabela otvara, koji listovi postoje i kako glasi CSV adresa za šablon |
| `tokenErzeugen()` | napravi jak `TOKEN_READ`, upiše ga i ispiše jednom — odatle ide u `Vorlage-Aufbau.bas` |
| `geschwindigkeitMessen()` | meri koliko traje čitanje listova na oba načina — vidi **Brzina** |
| `treueVergleichen()` | proverava da li drugi način vraća iste vrednosti i iste tipove |

Ako nešto ne radi, prvo pokreni `einrichtungPruefen()` i pogledaj protokol.

**`Invalid argument: id`** znači da `SHEET_ID` nije ispravan Drive ID.
Cela adresa je dozvoljena — kod iz nje izvuče ID — ali ID Apps Script
projekta ili ime foldera nisu. `einrichtungPruefen()` ispisuje šta je upisano
i šta je iz toga izvučeno.

**`setupAnlegen` sme da se pokrene i kasnije, više puta.** Zaglavlja se ne
diraju ako već postoje; ono što svaki put iznova postavlja jeste **tekstualni
format** na kolonama sa datumom i vremenom — `AngDat` `AngZeit` `GezDat`
`GezZeit` `EinDat` `EinZeit`, i `MHD` u `Positionen`. Bez njega Sheets upisano
`2026-09-09` čita kao datum a `08:30` kao vreme i vraća ih kao vremenske
pečate; u aplikaciji, u CSV-u i u Excel obrascu onda piše `Sat Dec 30 1899 …`.
Format ide preko cele visine lista, ne preko prvih n redova, i kolone se traže
po imenu.

**`setupAnlegen` ujedno dograđuje postojeću tabelu:** kolone iz nove verzije
koda koje u tabeli ne postoje dopisuje **na kraj** zaglavlja, nikad između,
i ne dira podatke. Tako živa instalacija povuče novu verziju bez ručnog
kucanja zaglavlja.

Ako tabela već radi, pokreni `setupAnlegen` ponovo posle ažuriranja koda.
Redovi upisani pre toga zadržavaju svoje vrednosti; datum i vreme koje je
Sheets bio pretvorio u vremenski pečat aplikacija sada sama vraća u tekst,
pa se ne moraju prekucavati.

Test u browseru:

```
<URL>?token=<TOKEN_READ>&format=csv
```

Mora vratiti CSV sa zaglavljem. Ako vidiš Google login stranicu,
`Zugriff` nije postavljen na *Jeder*.

**Svaka kasnija izmena koda traži novu verziju** —
*Bereitstellungen verwalten → Bearbeiten → **Neue Version***.
Bez toga URL i dalje servira stari kod. Ovo je najčešći uzrok
„izmenio sam, a ništa se nije promenilo".

⚠️ **Nikad „Neue Bereitstellung" za izmenu koda.** To pravi **novu adresu**,
a `CONFIG.url` u `index.html` i dalje pokazuje na staru. Ako se stara pri
tom arhivira, aplikacija dobija **HTTP 404** i ništa više ne radi. Aplikacija
taj slučaj prepoznaje i kaže baš to, umesto da traži proveru prava:

> *Diese Web-App-Adresse gibt es nicht (404). In Apps Script unter
> «Bereitstellungen verwalten» die aktuelle URL holen und in CONFIG.url
> eintragen.*

Ažuriranje je time svedeno na tri koraka bez ijednog polja za popunjavanje:
**zalepi `Code.gs` → Neue Version → `setupAnlegen`.** Skripteigenschaften
preživljavaju zamenu koda; `setupAnlegen` dopiše kolone kojih još nema.

## Faza 3 — Parametri (~3 min)

Tri foldera **već stoje** — napravio ih je `setupAnlegen`, pored same tabele:

```
Wareneingang/                  ← tu gde je i tabela
  Excel/           → ArchivOrdner       .xlsx, u podfolder GGGG-MM
  Lieferscheine/   → FotoOrdner         slike otpremnica, isto po mesecima
  Sicherung/       → SicherungOrdner    nedeljna kopija cele tabele
```

Ostaje samo **`MailAn`** — adresa koja dobija popunjeni `.xlsx`. Upiši je u
**Verwaltung** u aplikaciji, ili u list `Parameter`.

| `Schluessel` | `Wert` | Čemu služi |
|---|---|---|
| `MailAn` | `lager@firma.ch` | adresa koja dobija popunjeni .xlsx |
| `ArchivOrdner` | ID Drive foldera | tu se odlaže .xlsx, u podfolder `GGGG-MM` |
| `FotoOrdner` | ID Drive foldera | tu idu slike otpremnice, u podfolder `GGGG-MM` |
| `SicherungOrdner` | ID Drive foldera | tu ide nedeljna kopija cele tabele |

**Prazan `ArchivOrdner` znači: samo mejl, bez arhive.** Prazan `FotoOrdner`
znači: slika se tiho preskače, unos i dalje prolazi. Prazan `MailAn` je
jedini koji blokira — slanje tada javlja `kein_empfaenger`.

Zato `setupAnlegen` **ne pregazi ono što je već upisano**: prazno polje je
namerno gašenje, ne rupa. Ko obriše `FotoOrdner` da isključi slike, neće ga
dobiti nazad ponovnim pokretanjem.

**`SicherungOrdner` ne deli ni sa kim** — kopija sadrži list `Benutzer`, a u
njemu `PassHash` i `Salt`. Zato je odvojen od `Excel/`, koji se po pravilu
deli sa računovodstvom.

Za nedeljnu kopiju pokreni jednom **`sicherungPlanen()`** u editoru — sam
zakači okidač za nedelju oko 3h i ukloni eventualni duplikat, pa se ne mora
kroz UI za okidače.

Ovi parametri tiču se samo **slanja i arhive**. Šablon na SharePointu ne
koristi nijedan — on povlači CSV i ne zna ni za mejl ni za Drive.

## Faza 4 — PWA (~15 min)

1. `index.html` → u bloku `const CONFIG` upiši Web-App-URL
2. Logo i ikone su već unutra — isti kao u Spesenu, ništa se ne dira
3. Objavi sadržaj repoa na statični host sa HTTPS —
   Cloudflare Pages, Netlify, GitHub Pages

Kasnije izmene: `index.html` uredi direktno u GitHub browseru, ikonica
olovke → **Commit changes**. Za minut je promena vani.

HTTPS nije opcion: bez njega nema ikone na home screenu.

## Faza 5 — Prvi nalog (~10 min)

1. U `Benutzer` upiši **samo** svoj `Email` i `Name`
2. U koloni `Rolle` upiši `admin`
3. U Apps Scriptu pokreni `zugangVerschicken`
4. Stiže mejl sa lozinkom i linkom
5. Prijavi se u PWA i unesi jedan wareneingang

Dalje naloge otvaraš iz same aplikacije, dugmetom **Benutzer verwalten**.
`zugangVerschicken()` u editoru ostaje samo za prvi nalog.

---

## Tok rada

Na dnu obrasca stoje **tri kućice — Angenommen, Gezählt & kontrolliert,
Eingelagert**. Čekira se ono što je onaj ko unosi **sam uradio**; podrazumevano
je čekiran samo `Angenommen`, jer u najčešćem slučaju roba se prima i odmah
unosi. Ko samo prekucava tuđi papir, skida sve tri.

**Nigde se ne persira.** Aplikacija, pristupni mejl i `Wareneingang -
Kurzanleitung.md` — svuda *du*. Četiri provere u `backend.mjs` skeniraju ta
tri teksta i padaju čim se `Sie`, `Ihr` ili `Ihnen` vrati; peta pokazuje da
skener to uopšte ume da nađe. U klijentu se prvo uklanjaju komentari, jer u
nemačkom „Sie" u opisnom tekstu znači i prosto „one/oni" — pa bi provera
pucala na objašnjenju umesto na kopiji.

**Ime se nikad ne bira** — dolazi iz sesije, a datum i vreme sa servera.
Kućica kaže samo *koji red* se potpisuje, ne *ko* ga potpisuje.

Sve što nije čekirano kvitira se kasnije, iz pregleda dokumenta — i to važi
i za `Angenommen`. Otvoreni unosi vidljivi su celom timu, jer bi inače
kolega koji broji morao da čeka onog ko je primio.

Kod **Eingelagert** aplikacija prvo nudi listu pozicija sa poljem za
Regalplatznr. Isto polje stoji i u samom obrascu, po poziciji: ko odmah zna
gde roba ide, upisuje ga pri unosu. Na papiru je to kolona „Second Team".
Prazna polja ostaju prazna, kvitiranje ide svejedno.

**Status** je uvek najdalji kvitirani korak, ne poslednji kliknuti —
naknadno kvitiranje `Angenommen` ne vraća eingelagert dokument na početak.
Dokument bez ijednog potpisa ima status `erfasst`.

**Pregled je radni spisak, ne arhiva.** Bez pretrage lista pokazuje tvoje
unose i sve što je timu **još otvoreno** — najnovijih sto. Tuđi unos ispada
iz nje čim je `eingelagert`; posao je gotov i nikome više ne stoji na putu.

| | |
|---|---|
| tvoji unosi | uvek |
| tuđi | dok su otvoreni (status ≠ `eingelagert`) |
| stornirani | nikad |

**Admin ima uz naslov prekidač „Alle".** Njime pregled prelazi u ceo
bestand, uključujući tuđe završene dokumente — za onoga ko hoće da vidi šta
je tim uopšte uneo, a ne samo šta još traži ruku. Izbor preživi osvežavanje,
i naslov kaže koja ansicht važi (`Alle Wareneingänge` / `Offene und letzte`).

Da li neko sme da vidi sve **odlučuje server iz role u sesiji**, ne
aplikacija. To što običan korisnik ne vidi taj prekidač nije zaštita —
klijent može poslati `alle: true` i dobiće običnu listu.

**Pretraga** iznad liste traži po broju, kupcu, dobavljaču i imenu onoga ko
je uneo. Sa njom se gleda ceo bestand bez obzira na rolu, uključujući tuđe
završene dokumente: inače beleg od prošlog meseca iz aplikacije više ne bi
bio dostupan. Stornirani ne izlaze ni tako.

Poređenje mejla ide preko `trim()` na obe strane. Bez toga bi razmak na
kraju ćelije `Email` — otkucan rukom ili prekopiran — od tvog završenog
unosa napravio tuđi, i on bi ti nestao iz sopstvene liste.

U listi se ime onoga ko je uneo prikazuje **samo kad to nisi ti**, a već
poslati dokument nosi oznaku `gesendet` — da se isti obrazac ne pošalje
dvaput bez namere.

**Als Excel senden** može se pozvati u bilo kom trenutku i više puta.
Šalje trenutno stanje; ako se pošalje pre nego što je sve kvitirano,
ta polja u tabeli su prazna, isto kao na papiru.

**Zurückziehen** ne briše red nego ga označava. Nestaje iz liste i iz CSV-a,
ali ostaje u tabeli.

## Excel

**Glavni put: šablon na SharePointu.** `.xlsm` u biblioteci, Power Query
povlači CSV sa Apps Script URL-a, `Workbook_Open` osvežava pri otvaranju.
Arbeitsmappa ima list `Formular` (obrazac kao na papiru, dokument se bira
padajućom listom) i list `Liste` (zbirna evidencija). Prebacivanje sa
dokumenta na dokument ne traži osvežavanje.

Ceo postupak, sa formulama i rasporedom ćelija: **`EXCEL.md`**.

```
<Web-App-URL>?token=<TOKEN_READ>&format=csv&tage=365
```

Obrazac ima deset redova za pozicije. Duži dokument se ne odseca tiho:
red `A26`, unutar oblasti štampe, tada crveno javi koliko pozicija dokument
zaista ima. Isti red javi i kad `J2` pokazuje na broj kojeg u `Daten` nema.

Jedan red po poziciji, podaci zaglavlja se ponavljaju u svakom redu,
stornirani ispadaju. **23 kolone u fiksnom redosledu** — na njima stoje sve
formule šablona, pa nova kolona ide u `CSV_SPALTEN` **na kraj**, nikad
između. Poslednja kolona `Schluessel` (`WeNr-Nr`) je ono što pozicijama
dozvoljava običan `INDEX/VERGLEICH` umesto matrične formule.

Parametri: `&tage=` sužava na poslednjih n dana, `&we=` na jedan dokument.

**Sporedni put: Als Excel senden.** Zamrznut `.xlsx` po dokumentu, u prilogu
mejla i u `ArchivOrdner/GGGG-MM/`. Za slanje napolje — kupcu, dobavljaču, u
arhivu. Raspored je isti kao u listu `Formular`, namerno: kolone A–H,
potpisi u redovima 3–6, Kunde i Lieferant u 10–11, zaglavlje pozicija u redu 15.

U zaglavlju su ćelije spojene, jer je kolona A uska `N°` kolona tabele
pozicija a natpisi sa papira su dugački: **A:B** zadatak, **C:D** ime,
**E** datum, **F** vreme; isto i za Kunde/Lieferant (**A:B** natpis,
**C:F** vrednost) i za dve napomene (**A:H**). Bez toga se „Gezählt &
kontrolliert / counted & controlled" odseca ili razvuče red preko pola strane.
Layout stoji u `blattAufbauen` u `Code.gs`; **datoteke-šablona namerno nema**,
jer šablon koji se odvoji od koda je izvor tihih grešaka.

**Fajl na SharePointu se ne otvara iz browsera** — Excel for Web ne osvežava
Power Query i to ne javlja. Sinhronizuj biblioteku i otvaraj ga iz Findera.

## Foto po artiklu

Pored polja **Regalplatznr.** stoji dugme **Foto** — i u obrascu i na ekranu
za *Eingelagert*, jer je Regalplatz ono što se popunjava dok roba stoji pred
tobom.

| Stanje dugmeta | Šta radi dodir |
|---|---|
| `Foto` | otvara kameru |
| `✓ Foto` | prikazuje sliku, sa dugmetom **Foto entfernen** |

**Naziv datoteke je naziv artikla**, kako je traženo. Dve isporuke istog
artikla time dobijaju isto ime u Drive-u — to ne smeta, jer se slika nalazi
preko reda u tabeli, ne preko imena.

**Pri *Eingelagert* se dopunjava, ne prepisuje.** Ako slika već stoji u
redu, ostaje; ko slika pri odlaganju dodaje ono što pri unosu nije uhvaćeno.
Prepisivanje bi značilo tiho zameniti beleg.

Slika artikla se smanjuje na **1200 px / 68%** — otpremnica mora da bude
čitljiva, artikal samo prepoznatljiv, a kod deset pozicija ta razlika odlučuje
hoće li snimanje proći kroz slab signal.

U detalju svaka pozicija sa slikom nosi **Foto ansehen**; slika ide istim
putem kao otpremnica — sa servera, nikad linkom na Drive.

Stara instalacija bez kolone `FotoUrl` radi dalje: snimanje prolazi,
pozicija prosto javlja da slike nema. `setupAnlegen` dopisuje kolonu.

## Foto otpremnice

Slika ide u **Google Drive**, u tabelu samo link. Ćelija u Sheetsu ima
granicu od 50.000 znakova, pa slika u njoj nije opcija.

**Slika se smanjuje u browseru** pre slanja — 1600 px duža ivica, JPEG 72%,
oko 250 KB. Otpremnica mora ostati čitljiva, pa je ivica veća nego što bi
bila za običan račun. Bez tog koraka fotografija sa iPada je 4–8 MB,
u base64 preko 10 MB, i pada i Apps Script i mobilna veza.

**Slika se gleda kroz aplikaciju, ne kroz Drive.** U detalju stoji dugme
**Foto ansehen**; server pročita datoteku i pošalje same bajtove, a browser
sa Drive-om ne razgovara nikad.

Ranije je tu stajao link. Link **browser** otvara — sa onim Google nalogom
na kom je uređaj — pa je radnik na sopstvenom belegu dobijao *Zugriff
verweigert*. Prava u ovoj aplikaciji nisu prava u Drive-u, a radnik tamo
najčešće nema ni nalog.

Radi zato što web-app stoji na **Ausführen als: Ich**: skripta čita datoteku
pravima vlasnika. **ID datoteke uzima se iz reda u tabeli, nikad iz
zahteva** — inače bi ovo bilo dugme za čitanje bilo koje datoteke do koje
vlasnik dopire.

Slika se pamti u memoriji za poslednjih pet pregledanih dokumenata; drugi
dodir ne ide više na server. Ne u `localStorage` — tamo stoje lista i
stammdaten, koje lieferschein od par stotina kilobajta ne sme da istisne.

**Dozvole.** Podeli **korenski folder** sa nalogom računovodstva — pristup
se nasleđuje na sve podfoldere, i to je jedina postavka koju treba dirati.
**Radnicima ne treba pristup Driveu ni za slike** — folder sme da ostane
potpuno zatvoren.

## Verwaltung

Dugme **Verwaltung** vidi samo admin. Tu su dve stvari: podešavanja slanja i
korisnici. U tabelu se ne mora ulaziti ni za jedno.

### Slanje

| Polje | Šta je |
|---|---|
| Empfänger der Excel-Datei | `MailAn` — adresa koja dobija popunjeni `.xlsx` |
| Drive-Ordner für die Excel-Ablage | `ArchivOrdner` — prazno znači: samo mejl |
| Drive-Ordner für die Lieferschein-Fotos | `FotoOrdner` — prazno znači: slika se preskače |
| Drive-Ordner für die wöchentliche Sicherung | `SicherungOrdner` — prazno znači: nema kopije |

Kod oba foldera sme se **zalepiti cela Drive adresa** — server iz nje izvuče
ID. Ispod polja stoji **ime foldera** koji taj ID stvarno pogađa; ako piše da
nije dostižan, ID je pogrešan. To je jedina provera koja se isplati, jer ID
sam po sebi čoveku ne znači ništa.

Ista četiri parametra i dalje stoje u listu `Parameter` — aplikacija ih samo
upisuje umesto tebe.

**Folder za sigurnosnu kopiju ne deli ni sa kim.** Kopija sadrži list
`Benutzer`, a u njemu `PassHash` i `Salt`. Zato je odvojen od `ArchivOrdner`,
koji se po pravilu deli sa računovodstvom.

### Kontakti i kupci

Admin ih održava kroz aplikaciju; u tabelu se ne mora ulaziti.

**Kontakti** su spisak primalaca — ime i adresa. Deaktivirani ostaju u
tabeli ali nestaju iz predloga.

**Kod svakog kupca** stoje dve adrese: **Haupt** i **Stellvertretung**. Obe
su podrazumevani primaoci pri slanju — glavni u `An`, zamena u `Kopie`.

> Zamena je osoba koja uskače; ko tek u odsustvu sazna da je nešto
> isporučeno, uskače prekasno. Zato oboje dobijaju mejl, a ne samo prvi
> kad drugog nema.

**Ništa od toga nije prisila.** Pri slanju se otvara ekran sa poljima `An` i
`Kopie`, popunjenim iz te vrednosti — a radnik sme da izabere bilo kog
kontakta iz padajuće liste ili da prosto upiše adresu. Šta stoji u tom
ekranu, to i ide.

Redosled kojim server bira primaoca:

| | |
|---|---|
| 1 | šta je upisano u ekranu za slanje |
| 2 | `EmailHaupt` / `EmailVertretung` kod kupca |
| 3 | parametar `MailAn` — ostatak iz vremena kad je adresa bila jedna |

Prazno kod kupca znači **nema vrednosti**, ne greška; tek ako ni parametar
nije postavljen, slanje javlja `kein_empfaenger`.

Stara tabela bez kolona `EmailHaupt`/`EmailVertretung` radi dalje — slanje
pada na parametar, a admin dobija poruku da pokrene `setupAnlegen`.

### Korisnici

Korisnicima upravlja neko iz firme kroz samu aplikaciju, ne kroz tabelu.

**Ko je admin:** u koloni `Rolle` u listu `Benutzer` stoji `admin`.
Prvom adminu tu vrednost upisuješ ručno; on dalje može postavljati druge.

Admin može dodati korisnika, deaktivirati ga i ponovo aktivirati, poslati
novu lozinku, dodeliti ili oduzeti admin prava.

**Pristupni mejl insistira na Safariju.** Ne zato što drugi browseri ne
rade, nego zato što mnogi mejl programi otvaraju link u **sopstvenom
prozoru** — a tamo opcije „Zum Home-Bildschirm" nema. Radnik stigne do
prijave i dalje ne zna zašto ne ide. Zato mejl kaže: adresu kopirati,
otvoriti Safari, zalepiti. Uz to i da svaki browser pamti prijavu za sebe.
Tri provere u `backend.mjs` čuvaju te rečenice od tihog ispadanja pri
sledećoj izmeni teksta.

**Novi korisnik dobija mejl sa lozinkom** — upiši ime i adresu, čekiraj
*Zugangsmail verschicken* i pritisni **Benutzer anlegen**. Lozinka se posle
toga prikazuje **samo jednom**, za slučaj da mejl ne prođe; tekst poruke se
može kopirati dugmetom. Pri prvoj prijavi aplikacija traži sopstvenu lozinku.

**Ako ne vidiš dugme Verwaltung:** u koloni `Rolle` u listu `Benutzer` ne
piše `admin`, ili si se prijavio pre nego što je upisano. Rola se čita pri
prijavi — odjavi se i prijavi ponovo.

**Sopstveni nalog ne može da se deaktivira ni da sebi oduzme prava.**
Bez toga bi jedan pogrešan klik ostavio firmu bez ijednog admina.

**Prijava ne odaje da li nalog postoji.** Dok lozinka nije tačna, odgovor je
uvek `login` — i za nepoznatu adresu, i za deaktiviran nalog, i za zaključan.
Tek kad lozinka prođe, poruka sme reći više (`inaktiv`, `gesperrt`); ko je ne
zna, ne dobija potvrdu da je pogodio adresu.

**Posle isteka blokade brojač kreće od nule.** Inače bi prvi tipfeler posle
petnaest minuta čekanja odmah vratio blokadu.

**Lozinke se hešuju u 1000 prolaza** (`HASH_RUNDEN`), sa oznakom `v2$` na
početku. Jedan prolaz SHA-256 je toliko brz da je ukradena tabela praktično
jednaka lozinkama. Stari zapisi bez oznake i dalje važe i **zamenjuju se sami
pri prvoj sledećoj prijavi** — niko nije zaključan zbog ove izmene.

**Provera prava je na serveru, ne u aplikaciji.** Svaka `admin_*` akcija
prolazi kroz istu proveru role iz sesije. To što dugme kod običnog
korisnika nije vidljivo nije zaštita — klijent može poslati bilo šta.

---

## Brzina

**Vreme ne odlazi na server nego na put do njega.** Apps Script na POST
odgovara preusmerenjem, odgovor stiže sa drugog hosta, a skripta može biti
hladna. Merenja na istovetno građenom projektu (`handoverApp`) daju red
veličine:

| | |
|---|---|
| put — preusmerenje, drugi host, hladan start | **~2 400–2 900 ms po pozivu** |
| otvaranje tabele (`openById`) | 266–1 023 ms, **jednom po izvršavanju** |
| čitanje četiri lista preko `SpreadsheetApp` | 214–934 ms |

Zato je prvo pravilo: **manje poziva**, ne brži poziv. Otvaranje aplikacije
je bilo dva poziva jedan za drugim (`we_liste`, pa `stammdaten`), a prijava
tri. Sada je i jedno i drugo **jedan poziv**:

- akcija `start` vraća listu i stammdaten zajedno — i pritom proverava
  sesiju jednom umesto dvaput (svaka provera čita `Sessions` i `Benutzer`)
- `login` nosi iste podatke u istom odgovoru, pa se posle prijave ne ide
  ponovo na mrežu

`we_liste` i `stammdaten` ostaju: pretraga traži samo listu, a starija
verzija aplikacije mora i dalje moći da se prijavi. Ako Apps Script još ne
zna za `start`, aplikacija to prepozna po `unbekannte Aktion` i pređe na
stari put — sporije, ali radi, pa redosled ažuriranja (Pages / `Code.gs`)
više ništa ne lomi. Da se uzaludan poziv ne ponavlja, pamti se do
osvežavanja stranice.

**Vidi se da nešto teče.** Poziv ovde traje sekundama; bez vidljivog znaka
čovek pritisne drugi i treći put — s pravom, jer mu ništa ne kaže da je
prvi stigao.

| | |
|---|---|
| **čitanje** | tanka traka na vrhu; ekran ostaje upotrebljiv — ko hoće nazad, sme nazad |
| **pisanje** | traka **i** zastor preko celog ekrana, sa rečenicom šta se dešava |

Razlika nije stvar ukusa: pri pisanju drugi dodir zaista nešto pokvari, pri
čitanju ne.

To stoji u `post()`, ne na pojedinim dugmadima — tako nijedna nova akcija ne
može da zaboravi. Dugmad se i dalje sama preimenuju (*Speichern …*,
*Wird gesendet …*); to je finija informacija, ovo je ona koja nikad ne fali.

`admin_parameter` bez `werte` čita a sa `werte` piše — po samoj akciji se to
ne vidi, pa se gleda sadržaj.

**Poziv se prekida posle 45 s** (`GEDULD_MS`). `fetch` inače čeka večno, a
zastor bi tada zauvek ostao — aplikacija koja se više ne da koristiti gora je
od one koja javi grešku. Prekid za ostatak koda izgleda kao pad veze, a to je
svuda već obrađeno.

**Lista se crta sa uređaja, pa se ispravi.** Otvaranje aplikacije više ne
pokazuje „Wird geladen …" nego poslednje redove koje je uređaj video, a
sveži stižu iza toga. Iznad liste tada stoji crveno **`Letzter Stand vom
Gerät, geladen vor 12 Minuten. Wird aktualisiert …`** — bez te rečenice bi
nedelju dana star red izgledao kao onaj od malopre, a u magacinu neko po
njemu postupa. Čim stignu sveži redovi, natpis nestaje.

**Ekran nikad ne baca ono što je već tačno.** „Wird geladen …" preko redova
koji su ispravni pretvara nevidljiv poziv u osam sekundi čekanja. Baš to se
dešavalo pri povratku iz detalja: lista je stajala gotova, pa je bila
prekrivena natpisom o učitavanju. Sada:

| Situacija | Šta se vidi |
|---|---|
| povratak iz detalja | lista odmah, osvežavanje nevidljivo iza nje |
| dokument otvoren ranije | detalj odmah sa uređaja, pa se ispravi |
| prvi put, bez keša | `Wird geladen …` — jedini slučaj u kom je istinit |
| **pretraga** | prazni se — ti redovi su odgovor na **drugo** pitanje |

Detalji se pamte za **poslednjih 20** dokumenata i brišu pri odjavi, iz istog
razloga kao lista.

**Ništa zapamćeno ne odlučuje ništa.** Keširana lista određuje samo šta
stoji na ekranu dok sveža ne stigne. Svaka radnja i dalje ide na server,
koji red čita iznova: kvitiranje, slanje i storniranje tamo proveravaju
stanje, a otvaranje unosa ionako povlači detalj sa servera. Ako osvežavanje
padne, stari redovi ostaju na ekranu — ali natpis onda kaže i zašto
(`… Keine Verbindung.`). Prazan ekran ne bi bio iskreniji, samo beskorisniji.

Keš se briše pri odjavi: na zajedničkom iPadu imena kupaca i dobavljača
prethodnog korisnika ne tiču se sledećeg.

**Merenje je ugrađeno, da se ne bi nagađalo.** Svaki odgovor nosi `ms`
(vreme na serveru) i `teile` (po fazama: `auth`, pa akcija). Aplikacija od
svoje wall-clock vrednosti oduzme `ms` i u konzolu ispiše i put:

```
«start» 3120 ms — Server 640, Weg 2480 (auth 210 start 430)
```

Bez te razlike svaki spor poziv izgleda kao spor server, i prepravlja se
pogrešna strana. Ista zamka je u ovom projektu već jednom odradila svoje:
pretpostavka da `openById` u jednom izvršavanju košta svaki put bila je
netačna — platforma ga posle prvog puta servira iz sopstvenog keša.

### Provera sesije se pamti minut

Merenje na živoj tabeli (`geschwindigkeitMessen()`):

```
Tabelle oeffnen (nur eine Probe): 317 ms
SpreadsheetApp, 5 Lesevorgaenge:  min 1073  Median 1631  max 1914
Sheets batchGet, eine Anfrage:    min 161   Median 209   max 350
```

Dakle **jedno čitanje ≈ 330 ms**, a `doPost` u Ausführungen traje 2–5 s. Server
jeste uzrok, nije put.

Od pet čitanja, **dva su išla samo na to da se sazna ko šalje zahtev** —
`Sessions` i `Benutzer`, na svakom pozivu, uvek sa istim odgovorom. Sada se
provera pamti u `CacheService` **60 sekundi** (`SITZUNG_CACHE_SEK`).

**Sve što aplikacija sama promeni briše zapis odmah** — odjava,
deaktivacija, dodela i oduzimanje admin prava, nova lozinka. Zaostaje samo
izmena rađena **rukom u tabeli**, i to najviše minut.

Uz keš je jedna stvar morala da se popravi: `passwortSetzen` je verovao
broju reda iz sesije. Otkad sesija može da dođe iz keša, taj broj je
vrednost od malopre — pa se red sada traži po mejlu. Pogrešan broj bi
upisao tuđu lozinku.

### Sledeći korak — i zašto još nije urađen

Ono što **nije** dirano: `SpreadsheetApp` kao put do podataka. Ostaju dve
stavke u samoj skripti — otvaranje tabele (`openById`, jednom po
izvršavanju) i čitanje listova, jedan po jedan.
`Sheets.Spreadsheets.Values.batchGet` uzima sve opsege u **jednom**
zahtevu i pritom ne otvara ništa; na istovetnom projektu to je bilo 150 ms
umesto 1086.

Ali da li se to isplati **ovde, na ovim podacima**, pitanje je za brojeve,
ne za razmišljanje — razmišljanje se u ovom projektu već jednom prevarilo.
Zato prvo dve provere u editoru (traže **Dienste + → Google Sheets API**):

| Funkcija | Šta odgovara |
|---|---|
| `geschwindigkeitMessen()` | koliko traje čitanje na oba načina — 5 rundi, min/median/max i sirovi uzorci |
| `treueVergleichen()` | da li `batchGet` vraća **iste vrednosti i iste tipove**, ćeliju po ćeliju |

Drugi je važniji od prvog. Tri načina da prepravka tiho pukne:

1. **`batchGet` po pravilu vraća prikazani tekst.** `true` bi postalo
   `"TRUE"`, a `=== true` to ne prepoznaje — stornirani unosi bi se vratili
   u listu, neaktivni kupci takođe. `UNFORMATTED_VALUE` to sprečava.
2. **`batchGet` staje na poslednjoj popunjenoj ćeliji.** Red čije su
   poslednje kolone prazne vraća se **kraći**, a pošto se svuda pristupa po
   indeksu kolone, tamo bi stajalo `undefined` umesto `''`. `batchLesen`
   dopunjava i **broji** koliko je puta dopunio.
3. **Rezultati se ne uparuju po redosledu** nego po opsegu koji svaki sam
   imenuje. Osloniti se na redosled znači onog dana kad ne bude tačan
   pročitati `Benutzer` kao `Wareneingang` — i ništa ne bi izgledalo krivo.

Ovde postoji i zamka specifična za ovaj projekat: `AngDat`, `AngZeit` i
`MHD` stoje kao **tekst** u tabeli, da Sheets od `08:30` ne napravi vreme.
Šta `batchGet` od toga napravi odlučuje da li se u Excel obrascu opet
pojavi `Sat Dec 30 1899`. To se ne pretpostavlja — `treueVergleichen()`
gleda u živu tabelu.

Prepravka ide **samo ako oba izveštaja to opravdaju**: razlika preko pola
sekunde i nula odstupanja.

**Prvi je prošao ubedljivo** (1948 ms → 209 ms), **drugi nije**:
`treueVergleichen()` je na živoj tabeli našao **30 razlika, sve datumi i
vremena**. `batchGet` ih vraća kao tekst u formatu prikaza te kolone, a taj
format nije isti svuda:

```
Sessions «GueltigBis»: Date 2026-10-10 19:11  →  "10/10/2026 19:11:27"
Wareneingang «AngDat»: Date 2026-09-10 00:00  →  "2026-09-10"
Wareneingang «AngZeit»: Date 1899-12-30 12:40 →  "12:40"
```

Pogledaj šta to zapravo znači: za `AngDat` i `AngZeit` je tekst koji
`batchGet` vraća **već tačan** — bolji od `Date` koji `feldText()` mora da
leči. Opasne su samo tri tačke u kodu koje datum **porede**, i sve tri su
u `Sessions` i `Benutzer`:

```js
new Date(sd[i][2]) < new Date()                    // GueltigBis
new Date(dat[i][k.GesperrtBis]) > new Date()       // dvaput
```

`"10/10/2026"` se parsira po američkom čitanju — radi, dok jednog dana ne
proradi drugačije. Zato podela: **`Sessions` i `Benutzer` ostaju na
`SpreadsheetApp`** (keš ih ionako čini retkim), a `Wareneingang`,
`Positionen`, `Kunden` i `Lieferanten` idu na `batchGet`.

Rupa u samoj dijagnostici je zatvorena: `Positionen` nije bio u
`MESS_BLAETTER`, pa kolona `MHD` — ona koja odlučuje šta stiže u Excel
šablon — nikad nije ni upoređena. Ponovljeno merenje: **280 ćelija umesto
199, i dalje istih 30 razlika.** `Positionen` nije doneo nijednu; `MHD` je
čist. Podela je urađena.

### Kako je podeljeno

| List | Put | Zašto |
|---|---|---|
| `Sessions`, `Benutzer` | `SpreadsheetApp` | tu su sva tri poređenja datuma; keš ih ionako čini retkim |
| `Wareneingang`, `Positionen`, `Kunden`, `Lieferanten` | `batchGet` | sve odatle izlazi kao tekst kroz `feldText()` |
| bilo šta pre upisa | `SpreadsheetApp` | ko traži red da bi ga izmenio, čita ga iz istog izvora u koji piše |

Bez uključenog servisa sve pada nazad na `SpreadsheetApp` — sporije i
tačno, umesto aplikacije koja ne startuje zbog jednog podešavanja.

**Test koji nosi odluku nije brzina nego jednakost:** isti pozivi se voze
oba puta i rezultat mora biti **znak za znak isti**, iako sirove vrednosti
nisu (`Date` naspram `"2026-09-10"`). Attrapa u testu namerno vraća datume
kao tekst, tačno onako kako ih vraća pravi servis — inače bi taj test
prolazio bez ičega da dokaže.

Jedna stvar je pri tome morala da se ispravi. `Zeitstempel` se upisivao kao
`Date`, pa mu je izgled zavisio od formata prikaza kolone — a time i od
toga kojim putem se čita:

```
SpreadsheetApp  →  "2026-09-11 08:41"
batchGet        →  "9/11/2026 08:41:10"
```

Sada se upisuje kao tekst, i kolona je u `setupAnlegen` tekstualna, kao i
sve ostale vremenske. Isto i `Gesendet`: upisivao se kao tekst, ali ga je
Sheets bez tog formata vraćao natrag u datum.

**Zaostatak, pošteno rečeno:** redovi upisani pre ove izmene i dalje nose
`Date` u `Zeitstempel`, i preko `batchGet` se čitaju kao `9/11/2026 …`. To
polje se nigde ne prikazuje, nije u CSV-u i nije u Excelu — ali nije
identično. `setupAnlegen` pokrenut ponovo postavlja format; već upisane
vrednosti time se ne menjaju.

Usput popravljeno: `&tage=` je poredio `String(AngDat)` sa `yyyy-MM-dd`.
Gde je `AngDat` ostao datum, to je poredilo `"Thu Sep 10 2026 …"` i ništa
nije odsecalo. Sada ide kroz `feldText()`, pa oba slučaja stižu kao
`yyyy-MM-dd`.

---

## Testovi

Tri suite, sve bez mreže i bez Google naloga — **453 provere**:

```bash
node   tests/backend.mjs   # Code.gs nad Sheets-om u memoriji
node   tests/pwa.mjs       # pravi UI u Chromiumu, lažni Apps Script
python3 tests/vorlage.py   # formule Excel šablone nad pravim CSV-om
```

Zovu se iz root-a repoa. `pwa.mjs` traži Playwright — lokalno instaliran ili
globalno preko `NODE_PATH`; `vorlage.py` traži `openpyxl`. Ništa se ne dodaje
u repo.

`backend.mjs` cilja mesta gde klize indeksi kolona i redova: raspored kolona,
brojni niz po godini, upis pozicija, izbor kvitiranih koraka, naknadno
kvitiranje, storno, CSV, admin prava, raspored ćelija u Excel listu i
tekstualni format kolona sa datumom i vremenom. `pwa.mjs` vozi ceo tok —
prijava, unos, brisanje pozicije, Regalplatz pri unosu, čuvanje sa i bez
sopstvene kvitancije, kvitiranje, slanje, istekla sesija.
`vorlage.py` puni šablonu izlazom iz `csv_beispiel.mjs` i računa svaku formulu:
da li vuče pravu kolonu, da li se prazni redovi drže praznih, da li prelazak na
drugi dokument menja sve i da li se duži dokument javi umesto da se odseče.

**Šta `vorlage.py` NE dokazuje:** da Excel otvori fajl bez prigovora. Formule
su izračunate sopstvenim auswerter-om, ne Excel-kompatibilnim motorom.

**Dodaješ ponašanje — dodaj test.** Checklista u chatu važi samo za ono
što se ne može automatizovati: kako izgleda odštampan list, ponašanje na
pravom iPadu, kvalitet fotografije.

## Test pre predaje

Ovo se ne može automatizovati — radi se rukom, na pravom uređaju.

| # | Scenario | Očekivano |
|---|---|---|
| 1 | Pogrešna lozinka pet puta | šesti pokušaj odbijen i sa ispravnom lozinkom |
| 2 | Prva prijava lozinkom iz mejla | traži svoju lozinku, nema preskakanja |
| 3 | Posle promene lozinke | drugi uređaj traži ponovnu prijavu |
| 4 | Unos bez kunde i bez lieferanta | odbijen sa jasnom porukom |
| 5 | Unos sa pet praznih pozicija | odbijen |
| 6 | `3,4` i `3.4` u polju kg | oba daju 3.4 |
| 7 | Brisanje srednje pozicije | ostale zadržavaju vrednosti, brojevi se preračunaju |
| 8 | Kolega kvitira *Gezählt* | njegovo ime, ne ime onog ko je uneo |
| 9 | Isti korak dva puta | drugi put odbijen |
| 10 | *Eingelagert* sa praznim regalima | prolazi, polja ostaju prazna |
| 10b | Unos sa sve tri kućice čekirane | sva tri potpisa na tvoje ime, status `eingelagert` |
| 10c | Unos bez ijedne kućice | status `erfasst`, sva tri koraka nude *Quittieren* |
| 10d | Regalplatznr. upisan pri unosu | vidi se u detalju i u Excelu, bez koraka *Eingelagert* |
| 11 | Slanje pre nego što je sve kvitirano | prolazi, prazna polja u xlsx-u |
| 12 | Otvoriti xlsx u Excelu na Macu | raspored kao na papiru, žuta kolona H |
| 12b | Otvoriti .xlsm sa SharePointa iz Findera | podaci trenutni, padajuća lista puna |
| 12c | Dokument sa 12 pozicija u šablonu | prvih 10, crveno upozorenje u `A26` |
| 12d | `kg 3.4` na nemački podešenom Excelu | ostaje 3.4, ne postane 34 |
| 12e | Polje *Uhrzeit* u aplikaciji i u Excelu | `08:30`, ne datum iz 1899. |
| 12f | Odštampan mejl-xlsx | natpisi u zaglavlju čitljivi, nijedan red preko pola strane |
| 21 | Admin zalepi celu Drive adresu u polje za folder | sačuva se ID, ispod stoji ime foldera |
| 22 | Admin upiše `lager.firma.ch` bez `@` | odbijeno, stari unos ostaje |
| 23 | Novi korisnik iz Verwaltung, sa čekiranim mejlom | mejl stiže, lozinka se vidi jednom |
| 23b | Novi kontakt bez `@` | odbijen, poruka pored polja |
| 23c | Kod kupca upisati Haupt i Stellvertretung | *Als Excel senden* nudi obe |
| 23d | U ekranu za slanje upisati treću adresu | ide na nju, ne na vrednost |
| 23e | Kupac bez vrednosti | uzima se `MailAn` |
| 24 | Avionski režim usred *Speichern*, pa ponovo *Speichern* | jedan dokument, ne dva |
| 24b | Pritisnuti *Speichern* pa odmah još pet puta | jedan poziv, zastor pokriva dugme |
| 24c | Izvući mrežu usred snimanja | zastor nestaje, poruka stoji |
| 25 | *Abmelden*, pa isti token ubačen ručno | odbijen sa `session` |
| 26 | Odštampan list iz šablona i iz mejla | broj `WE-…-….` stoji gore desno |
| 27 | Zameniti ceo `Code.gs` novom verzijom | radi bez unošenja ijedne vrednosti |
| 28 | Obrisati `TOKEN_READ` iz skripteigenschaften | CSV izlaz vraća `kein Zugriff` |
| 29 | Prijava na nepostojeću adresu i na deaktiviran nalog | ista poruka u oba slučaja |
| 30 | Sačekati da blokada istekne, pa jednom pogrešiti | ne zaključava odmah |
| 31 | Prijava naloga napravljenog pre ove verzije | prolazi; heš u tabeli dobija `v2$` |
| 32 | Pretraga po imenu dobavljača od pre dva meseca | nađe i tuđ završen dokument |
| 32b | Kolega kvitira *Eingelagert*, pa pogledaš pregled | njegov unos je nestao iz liste |
| 32c | Isti slučaj, pa pritisneš **Alle** | vratio se, naslov `Alle Wareneingänge` |
| 32d | Običan korisnik: ima li dugme **Alle** | nema ga |
| 32e | Razmak na kraju u koloni `Email` tvog završenog unosa | i dalje ga vidiš u svojoj listi |
| 37 | Otvoriti jedan unos, nazad, pa drugi kod kog učitavanje padne | nema dugmadi, `Nochmal versuchen` stoji |
| 37b | Pritisnuti `Nochmal versuchen` | učitava **taj** dokument, dugmad se vrate |
| 38 | Otvoriti detalj, pa nazad | lista odmah, bez `Wird geladen` |
| 38b | Otvoriti isti dokument drugi put | odmah, uz natpis `Stand vom Gerät` |
| 38c | Ukucati pojam u pretragu | stari redovi nestaju, stoji `Wird gesucht …` |
| 33 | `<Web-App-URL>?action=we_liste&session=…` u browseru | ne izvršava ništa |
| 34 | Pokrenuti `setupAnlegen` dvaput | folderi se ne dupliraju, upisi ostaju |
| 35 | Obrisati `FotoOrdner`, pa `setupAnlegen` | ostaje prazan — gašenje je namerno |
| 36 | Pokrenuti `sicherungPlanen()` dvaput | jedan okidač, ne dva |
| 13 | Devet pozicija | tabela naraste, podnožje se pomeri |
| 14 | Avionski režim, pa Speichern | jasna poruka, bez tihog gubitka |
| 15 | Ikona na home screenu, ponovno otvaranje | prijava se ne traži |
| 16 | Fotografija otpremnice na slaboj vezi | dugme pokazuje napredak |
| 16b | Nalog **bez** pristupa Driveu otvara *Foto ansehen* | slika se vidi |
| 16c | Isti dokument drugi put | odmah, bez poziva servera |
| 16d | Slika kod pozicije, pa *Speichern* | u detalju stoji `Foto ansehen` |
| 16e | Kod *Eingelagert* slikati poziciju koja već ima sliku | stara ostaje |
| 16f | Datoteka u Drive-u | zove se kao artikal |
| 17 | Običan korisnik pošalje `admin_liste` ručno | odbijeno sa `keine Berechtigung` |
| 18 | Admin pokuša da deaktivira sebe | odbijeno |
| 19 | Zurückziehen tuđeg unosa bez admin prava | odbijeno |
| 20 | Štampa xlsx-a na A4 | staje na jednu stranu |

Test 1 zaključava nalog na 15 minuta — radi ga sa testnim nalogom.

---

## Šta ovaj model ne pokriva

**Aplikacija nikad ne šalje dva poziva istovremeno.** Za Apps Script su to
dva izvršavanja istog skripta, i drugo ume da se vrati sa HTML stranicom
greške umesto sa JSON-om. Prijava je do sada radila baš to — `ladeListe()`
bez `await`, pa odmah `stammdaten` — kao i otvaranje Verwaltung. Sada idu
jedan za drugim, i test to čuva: attrapa broji koliko ih je u letu i tvrdi
da nikad nije više od jednog.

**„unbekannte Aktion" znači: aplikacija je novija od skripte.** Merge na
GitHubu osvežava samo Pages; `Code.gs` u Apps Script ne stiže sam. Poruka
zato kaže baš to — koji korak nedostaje i gde — umesto da ponovi kod
greške i pošalje čoveka da traži na pogrešnom mestu.

**Kad server odbije, poruka nosi njegov razlog.** Poznati razlozi dobijaju
rečenicu, ostali se ispisuju onako kako su stigli — `Nicht geladen. Der
Server meldet: …`. Golo „Nicht geladen." je krilo baš ono što treba znati i
slalo čoveka da traži problem u mreži, koje nema. Brojač unosa se pri tom
briše: inače stoji od prethodnog uspešnog učitavanja i tvrdi da ima unosa
koje niko ne vidi.

**Detalj koji se nije učitao nije detalj.** Ako `we_detail` padne, ekran ne
sme da ostane kao da je sve na mestu. Ranije jeste: u zaglavlju je pisao
novi broj, ispod poruka o grešci — a **`S.detail` je i dalje držao prethodno
otvoreni dokument**. Šest mesta u aplikaciji čita baš njega, pa bi
*Zurückziehen* povuklo **pogrešan wareneingang**, sa potvrdnim pitanjem koje
izgleda ispravno.

Sada `detailOeffnen` **prvo zaboravi** šta je tu bilo, sakrije dugmad dok
dokument stvarno ne stigne, i obriše brojač pozicija. Na mestu greške stoji
**Nochmal versuchen** — najčešći uzrok (`nur_post`) je prolazan, pa je jedan
dodir dovoljan umesto povratka u listu i ponovnog otvaranja. Same radnje uz
to proveravaju `S.detail`, ali to je poslednja linija, ne prva.

**Apps Script na POST odgovara preusmerenjem.** Kad ga browser prati, po
HTTP standardu se POST pretvara u **GET** i telo zahteva nestane. Sporadično
to preusmerenje završi natrag na `/exec`, pa se izvrši `doGet` umesto
`doPost` — skript pri tom **ne uradi ništa**.

`doGet` zato odgovara JSON-om `{ok:false, error:"nur_post"}`, a ne golim
tekstom: aplikacija tako prepoznaje slučaj i **pošalje poziv ponovo**. Pošto
se ništa nije desilo, to važi i za kvitiranje i za slanje.

Isti kvar je postojao i ranije, samo je drukčije izgledao: pre grupe C
`doGet` je propadao do `verteilen({})` i vraćao `{"error":"session"}`, pa je
aplikacija **izbacivala korisnika na prijavu** bez vidljivog razloga.

**Google povremeno vrati `404` na ispravnu adresu.** Viđeno u pogonu: jednom
padne, posle osvežavanja radi. Takav odgovor dolazi sa Google-ovog frontenda
**pre nego što se skript uopšte pokrene** — ništa nije pročitano, ništa
upisano, nijedan mejl poslat. Zato se `404`, `429`, `502`, `503` i `504`
ponavljaju **i kod poziva koji se inače ne smeju ponavljati**: nema šta da se
udvostruči. `500` nije na spisku — greška u samom skriptu može nastupiti
pošto je već nešto uradio.

`200` sa HTML-om i `403` se ne ponavljaju: tu je skript odgovorio, samo
pogrešno, ili nema prava. Drugi pokušaj tu ne menja ništa.

**Prekinut poziv se ponavlja jednom — ali samo tamo gde drugi pokušaj ništa
ne kvari:** čitanje (`stammdaten`, `we_liste`, `we_detail`, `admin_*`) i
`we_speichern`, koje ionako spaja ključ vorganga. **Kvitiranje i slanje se ne
ponavljaju** — drugi pokušaj bi našao korak već kvitiran, odnosno poslao mejl
dvaput. Razmak je 700 ms.

Ako je server **odgovorio** ali ne JSON-om, drugi pokušaj ne pomaže i ne
dešava se. Tada poruka i kaže šta je: „Der Server hat kein JSON geliefert.
Bereitstellung prüfen." Ista poruka stoji na **svim** ekranima — ranije su je
imali samo prijava i čuvanje, pa je pogrešan deployment na listi izgledao kao
nestala mreža.

Kad odgovor **nije JSON**, poruka nosi i **HTTP status i prvih 90 znakova
odgovora** — `[HTTP 200: <!DOCTYPE html>…]`. Bez toga „nije JSON" ostaje
dijagnoza bez nalaza: `200` sa HTML-om, `401` i `429` traže tri različita
poteza, a niko neće otvarati konzolu na iPadu da bi ih razlikovao.

Pravi razlog prekida uvek ide u konzolu (`Aufruf «we_liste» Versuch 1 von 2
gescheitert: TypeError / Failed to fetch`), jer na ekranu radniku ne znači
ništa.

**Nema offline unosa.** Aplikacija traži mrežu. U magacinu sa slabim
signalom to se oseti. Ako se pokaže da je potrebno, dodaje se IndexedDB
outbox bez izmene backenda.

Ono što jeste rešeno je **prekid usred slanja**: svaki unos nosi ključ
vorganga, server ga upisuje u kolonu `Vorgang`, i drugi pokušaj sa istim
ključem vraća postojeći broj umesto da otvori novi dokument. Zato poruka i
ne tvrdi da ništa nije sačuvano — ona kaže da se sme pokušati ponovo.

**Podaci su izvan tenanta firme.** Odluku o tome treba da potvrdi firma.
Isto važi i za Spesen; ako je tamo prošlo, prolazi i ovde.

**Lozinka jednom prođe kroz nešifrovanu poštu.** Kolona `PwGeaendert`
stoji na `false` dok korisnik ne postavi svoju; do tada ga aplikacija ne
pušta dalje od ekrana za promenu. Ako i to smeta, zamena je Google
Sign-In — `login` tada prima ID token umesto lozinke, ostatak arhitekture
se ne menja.

**Sheets nema verzionisanje kakvo ima SharePoint.** Funkcija `sicherung()`
pravi kopiju u folder iz parametra `SicherungOrdner`; `sicherungPlanen()`
joj jednom zakači nedeljni okidač. Bez tog parametra ne radi ništa i to javi.

**Nema izmene posle čuvanja.** Pogrešan unos se povlači i unosi ponovo.
Za obrazac koji se potpisuje u tri koraka to je namerno: izmena posle
kvitiranja obesmislila bi potpis.

**Nema kontrole da se roba stvarno slaže sa otpremnicom.** Obrazac to i
ne traži — na papiru piše da se količine štrihaju direktno na otpremnici.
