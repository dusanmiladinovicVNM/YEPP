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
icons/icon-192.png         ← zamijeni
icons/icon-512.png         ← zamijeni
icons/icon-maskable-512.png ← zamijeni

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
| `:root` u `<style>` | boje; akcentna žuta je `#E0A32E` |
| `<symbol id="logo">` | logotip — zameni sadržaj svojim SVG-om |
| `const CONFIG` | Web-App-URL iz Apps Scripta |

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
| `Positionen` | `WeNr` `Nr` `Artikel` `Anzahl` `KG` `MHD` `Regalplatz` `Bemerkung` `Bestehend` |
| `Kunden` | `Name` `Aktiv` `Sortierung` |
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
   | `SHEET_ID` | ID tabele, iz URL-a između `/d/` i `/edit` |
   | `PWA_URL` | adresa PWA, ide u pristupne mejlove |
   | `TOKEN_READ` | štiti CSV izlaz — ili pokreni `tokenErzeugen()` |

3. Pokreni **`setupAnlegen`** jednom — pravi sve listove i zaglavlja
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

Ako nešto ne radi, prvo pokreni `einrichtungPruefen()` i pogledaj protokol.

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
*Bereitstellungen verwalten → Bearbeiten → Neue Version*.
Bez toga URL i dalje servira stari kod. Ovo je najčešći uzrok
„izmenio sam, a ništa se nije promenilo".

Ažuriranje je time svedeno na tri koraka bez ijednog polja za popunjavanje:
**zalepi `Code.gs` → Neue Version → `setupAnlegen`.** Skripteigenschaften
preživljavaju zamenu koda; `setupAnlegen` dopiše kolone kojih još nema.

## Faza 3 — Parametri (~10 min)

U listu `Parameter`, kolona `Schluessel` / `Wert`:

| `Schluessel` | `Wert` | Čemu služi |
|---|---|---|
| `MailAn` | `lager@firma.ch` | adresa koja dobija popunjeni .xlsx |
| `ArchivOrdner` | ID Drive foldera | tu se odlaže .xlsx, u podfolder `GGGG-MM` |
| `FotoOrdner` | ID Drive foldera | tu idu slike otpremnice, u podfolder `GGGG-MM` |
| `SicherungOrdner` | ID Drive foldera | tu ide nedeljna kopija cele tabele |

ID foldera je deo URL-a posle `/folders/`.

**Prazan `ArchivOrdner` znači: samo mejl, bez arhive.** Prazan `FotoOrdner`
znači: slika se tiho preskače, unos i dalje prolazi. Prazan `MailAn` je
jedina od te tri koja blokira — slanje tada javlja `kein_empfaenger`.

Ova tri parametra tiču se samo **slanja**. Šablon na SharePointu ne koristi
nijedan od njih — on povlači CSV i ne zna ni za mejl ni za Drive.

## Faza 4 — PWA (~15 min)

1. `index.html` → u bloku `const CONFIG` upiši Web-App-URL
2. `index.html` → u `<symbol id="logo">` zalepi svoj SVG logotip;
   svetla verzija, jer taman logo na crnoj podlozi nestaje
3. `icons/` → kvadratne PNG ikone, **samo znak bez teksta**, oko 10%
   praznog ruba. Priložene su privremene — zameni ih.
4. Objavi sadržaj repoa na statični host sa HTTPS —
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

## Foto otpremnice

Slika ide u **Google Drive**, u tabelu samo link. Ćelija u Sheetsu ima
granicu od 50.000 znakova, pa slika u njoj nije opcija.

**Slika se smanjuje u browseru** pre slanja — 1600 px duža ivica, JPEG 72%,
oko 250 KB. Otpremnica mora ostati čitljiva, pa je ivica veća nego što bi
bila za običan račun. Bez tog koraka fotografija sa iPada je 4–8 MB,
u base64 preko 10 MB, i pada i Apps Script i mobilna veza.

**Dozvole.** Podeli **korenski folder** sa nalogom računovodstva — pristup
se nasleđuje na sve podfoldere, i to je jedina postavka koju treba dirati.
Radnicima ne treba pristup Driveu; oni šalju kroz aplikaciju.

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

### Korisnici

Korisnicima upravlja neko iz firme kroz samu aplikaciju, ne kroz tabelu.

**Ko je admin:** u koloni `Rolle` u listu `Benutzer` stoji `admin`.
Prvom adminu tu vrednost upisuješ ručno; on dalje može postavljati druge.

Admin može dodati korisnika, deaktivirati ga i ponovo aktivirati, poslati
novu lozinku, dodeliti ili oduzeti admin prava.

**Novi korisnik dobija mejl sa lozinkom** — upiši ime i adresu, čekiraj
*Zugangsmail verschicken* i pritisni **Benutzer anlegen**. Lozinka se posle
toga prikazuje **samo jednom**, za slučaj da mejl ne prođe; tekst poruke se
može kopirati dugmetom. Pri prvoj prijavi aplikacija traži sopstvenu lozinku.

**Ako ne vidiš dugme Verwaltung:** u koloni `Rolle` u listu `Benutzer` ne
piše `admin`, ili si se prijavio pre nego što je upisano. Rola se čita pri
prijavi — odjavi se i prijavi ponovo.

**Sopstveni nalog ne može da se deaktivira ni da sebi oduzme prava.**
Bez toga bi jedan pogrešan klik ostavio firmu bez ijednog admina.

**Provera prava je na serveru, ne u aplikaciji.** Svaka `admin_*` akcija
prolazi kroz istu proveru role iz sesije. To što dugme kod običnog
korisnika nije vidljivo nije zaštita — klijent može poslati bilo šta.

---

## Testovi

Tri suite, sve bez mreže i bez Google naloga — **359 provera**:

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
| 24 | Avionski režim usred *Speichern*, pa ponovo *Speichern* | jedan dokument, ne dva |
| 25 | *Abmelden*, pa isti token ubačen ručno | odbijen sa `session` |
| 26 | Odštampan list iz šablona i iz mejla | broj `WE-…-….` stoji gore desno |
| 27 | Zameniti ceo `Code.gs` novom verzijom | radi bez unošenja ijedne vrednosti |
| 28 | Obrisati `TOKEN_READ` iz skripteigenschaften | CSV izlaz vraća `kein Zugriff` |
| 13 | Devet pozicija | tabela naraste, podnožje se pomeri |
| 14 | Avionski režim, pa Speichern | jasna poruka, bez tihog gubitka |
| 15 | Ikona na home screenu, ponovno otvaranje | prijava se ne traži |
| 16 | Fotografija otpremnice na slaboj vezi | dugme pokazuje napredak |
| 17 | Običan korisnik pošalje `admin_liste` ručno | odbijeno sa `keine Berechtigung` |
| 18 | Admin pokuša da deaktivira sebe | odbijeno |
| 19 | Zurückziehen tuđeg unosa bez admin prava | odbijeno |
| 20 | Štampa xlsx-a na A4 | staje na jednu stranu |

Test 1 zaključava nalog na 15 minuta — radi ga sa testnim nalogom.

---

## Šta ovaj model ne pokriva

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
u `Code.gs` pravi kopiju u folder iz parametra `SicherungOrdner` — zakači je
na nedeljni vremenski okidač. Bez tog parametra ne radi ništa i to javi.

**Nema izmene posle čuvanja.** Pogrešan unos se povlači i unosi ponovo.
Za obrazac koji se potpisuje u tri koraka to je namerno: izmena posle
kvitiranja obesmislila bi potpis.

**Nema kontrole da se roba stvarno slaže sa otpremnicom.** Obrazac to i
ne traži — na papiru piše da se količine štrihaju direktno na otpremnici.
