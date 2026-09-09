# Wareneingang

Kompletno rešenje: PWA → Google Sheets → Excel po mejlu.
Bez Microsoft licenci, bez Azure-a, bez SharePoint API-ja.

```
PWA  →  Apps Script Web-App  →  Google Sheets
                             →  .xlsx  →  mejl + Drive folder
```

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

tests/pwa.mjs              vozi pravi UI u Chromiumu sa lažnim backendom
tests/backend.mjs          vozi Code.gs nad Sheets-om u memoriji

README.md                  ovaj fajl
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
| `Wareneingang` | `WeNr` `Zeitstempel` `Erfasser` `Email` `Kunde` `Lieferant` `AngNam` `AngDat` `AngZeit` `GezNam` `GezDat` `GezZeit` `EinNam` `EinDat` `EinZeit` `LagerM2` `Bemerkung` `Storniert` `Status` `FotoUrl` `DateiUrl` `Gesendet` |
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
2. Na vrhu postavi `SHEET_ID`, `PWA_URL` i `TOKEN_READ`
3. Pokreni **`setupAnlegen`** jednom — pravi sve listove i zaglavlja
4. **Bereitstellen → Neue Bereitstellung → Web-App**
   *Ausführen als: Ich*, *Zugriff: Jeder*
5. Prvi put traži odobrenje za tabelu, Drive i slanje pošte — potvrdi
6. Zapiši **Web-App-URL**

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

## Faza 3 — Parametri (~10 min)

U listu `Parameter`, kolona `Schluessel` / `Wert`:

| `Schluessel` | `Wert` | Čemu služi |
|---|---|---|
| `MailAn` | `lager@firma.ch` | adresa koja dobija popunjeni .xlsx |
| `ArchivOrdner` | ID Drive foldera | tu se odlaže .xlsx, u podfolder `GGGG-MM` |
| `FotoOrdner` | ID Drive foldera | tu idu slike otpremnice, u podfolder `GGGG-MM` |

ID foldera je deo URL-a posle `/folders/`.

**Prazan `ArchivOrdner` znači: samo mejl, bez arhive.** Prazan `FotoOrdner`
znači: slika se tiho preskače, unos i dalje prolazi. Prazan `MailAn` je
jedina od te tri koja blokira — slanje tada javlja `kein_empfaenger`.

**Ako računovodstvu treba SharePoint,** najjeftiniji put je da `MailAn`
pokazuje na adresu SharePoint biblioteke; Microsoft to prima kao običan
mejl i sam odlaže prilog. Drugi put je sinhronizacija Drive foldera. Nijedan
ne traži registraciju aplikacije ni Azure.

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

**Angenommen** se kvitira sam, u trenutku unosa — ko je uneo, taj je primio.
Zato se u formularu ne bira ime; ono dolazi iz sesije.

**Gezählt & kontrolliert** i **Eingelagert** kvitiraju se kasnije, iz
pregleda. Otvoreni unosi vidljivi su celom timu, jer bi inače kolega koji
broji morao da čeka onog ko je primio.

Kod **Eingelagert** aplikacija prvo nudi listu pozicija sa poljem za
Regalplatznr. — to je kolona koju na papiru popunjava „Second Team".
Prazna polja ostaju prazna, kvitiranje ide svejedno.

**Als Excel senden** može se pozvati u bilo kom trenutku i više puta.
Šalje trenutno stanje; ako se pošalje pre nego što je sve kvitirano,
ta polja u tabeli su prazna, isto kao na papiru.

**Zurückziehen** ne briše red nego ga označava. Nestaje iz liste i iz CSV-a,
ali ostaje u tabeli.

## Excel

Popunjeni obrazac stiže kao **.xlsx u prilogu mejla**, jedan po
wareneingangu, i istovremeno se odlaže u `ArchivOrdner/GGGG-MM/`.

Raspored preslikava papir: kolone A–H, potpisi u redovima 3–6, Kunde i
Lieferant u 10–11, zaglavlje pozicija u redu 15, pozicije od 16. Minimum
je pet redova kao na papiru; ako ih ima više, tabela raste i podnožje
(`Lagerfläche`, `Umrechnung`) se pomera naniže.

Layout stoji u funkciji `blattAufbauen` u `Code.gs`. **Datoteke-šablona
namerno nema** — šablon koji se odvoji od koda je izvor tihih grešaka.

Za **zbirni** pregled preko svih wareneingänge postoji CSV:

```
<URL>?token=<TOKEN_READ>&format=csv
```

Jedan red po poziciji, sa podacima zaglavlja uz svaku. U Excelu:
**Daten → Aus dem Web**, autentifikacija **Anonym**.

**Fajl na SharePointu se ne otvara iz browsera** — Excel for Web ne
osvežava Power Query i to ne javlja. Sinhronizuj biblioteku i otvaraj ga
iz Findera.

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

## Admin-Bereich

Korisnicima upravlja neko iz firme kroz samu aplikaciju, ne kroz tabelu.

**Ko je admin:** u koloni `Rolle` u listu `Benutzer` stoji `admin`.
Prvom adminu tu vrednost upisuješ ručno; on dalje može postavljati druge.

Admin vidi dugme **Benutzer verwalten**. Tamo može dodati korisnika,
deaktivirati i ponovo aktivirati, poslati novu lozinku, dodeliti ili
oduzeti admin prava.

**Sopstveni nalog ne može da se deaktivira ni da sebi oduzme prava.**
Bez toga bi jedan pogrešan klik ostavio firmu bez ijednog admina.

**Provera prava je na serveru, ne u aplikaciji.** Svaka `admin_*` akcija
prolazi kroz istu proveru role iz sesije. To što dugme kod običnog
korisnika nije vidljivo nije zaštita — klijent može poslati bilo šta.

---

## Testovi

Dve suite, obe bez mreže i bez Google naloga:

```bash
node tests/backend.mjs     # Code.gs nad Sheets-om u memoriji
node tests/pwa.mjs         # pravi UI u Chromiumu, lažni Apps Script
```

Zovu se iz root-a repoa. `tests/pwa.mjs` traži Playwright — lokalno
instaliran ili globalno preko `NODE_PATH`; ništa se ne dodaje u repo.

`backend.mjs` cilja mesta gde klize indeksi kolona i redova: raspored
kolona, brojni niz po godini, upis pozicija, kvitiranje, storno, CSV,
admin prava i raspored ćelija u Excel listu. `pwa.mjs` vozi ceo tok —
prijava, unos, brisanje pozicije, čuvanje, kvitiranje, Regalplatz,
slanje, istekla sesija.

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
| 11 | Slanje pre nego što je sve kvitirano | prolazi, prazna polja u xlsx-u |
| 12 | Otvoriti xlsx u Excelu na Macu | raspored kao na papiru, žuta kolona H |
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

**Podaci su izvan tenanta firme.** Odluku o tome treba da potvrdi firma.
Isto važi i za Spesen; ako je tamo prošlo, prolazi i ovde.

**Lozinka jednom prođe kroz nešifrovanu poštu.** Kolona `PwGeaendert`
stoji na `false` dok korisnik ne postavi svoju; do tada ga aplikacija ne
pušta dalje od ekrana za promenu. Ako i to smeta, zamena je Google
Sign-In — `login` tada prima ID token umesto lozinke, ostatak arhitekture
se ne menja.

**Sheets nema verzionisanje kakvo ima SharePoint.** Funkcija `sicherung()`
u `Code.gs` pravi kopiju — zakači je na nedeljni vremenski okidač.

**Nema izmene posle čuvanja.** Pogrešan unos se povlači i unosi ponovo.
Za obrazac koji se potpisuje u tri koraka to je namerno: izmena posle
kvitiranja obesmislila bi potpis.

**Nema kontrole da se roba stvarno slaže sa otpremnicom.** Obrazac to i
ne traži — na papiru piše da se količine štrihaju direktno na otpremnici.
