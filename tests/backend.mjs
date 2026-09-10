/**
 * Prueft Code.gs gegen das Tabellen-Gerippe. Ziel sind die Stellen, an denen
 * Spalten- und Zeilenindizes verrutschen.
 */
import { Sheet, neueTabelle, laden, mitBenutzer, felder, POS } from './gerippe.mjs';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else   { fail++; console.log('  FAIL  ' + n + (extra ? '\n        ' + extra : '')); }
};

/* ============================ Tests ============================ */

console.log('\n1) Spaltenzuordnung');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const k = ctx.spalten(['WeNr', '', 'Kunde', 'Lieferant']);
  ok('leere Kopfzellen werden uebersprungen',
     k.WeNr === 0 && k.Kunde === 2 && k.Lieferant === 3, JSON.stringify(k));
  // Umgestellte Reihenfolge muss weiterhin passen
  const bl = ss.blaetter.Kunden;
  bl.daten[0] = ['Sortierung', 'Name', 'Aktiv'];
  bl.appendRow([20, 'Beta AG', true]);
  bl.appendRow([10, 'Alpha AG', true]);
  bl.appendRow([5, 'Weg AG', false]);
  const l = ctx.listeAktiv('Kunden');
  ok('Spaltenreihenfolge in der Tabelle ist egal',
     JSON.stringify(l) === '["Alpha AG","Beta AG"]', JSON.stringify(l));
  ok('inaktive fallen raus', !l.includes('Weg AG'));
}

console.log('\n2) Nummernkreis');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const jahr = new Date().getFullYear();
  ok('erste Nummer', ctx.naechsteNummer() === 'WE-' + jahr + '-0001');
  ss.blaetter.Wareneingang.appendRow(['WE-' + jahr + '-0009']);
  ss.blaetter.Wareneingang.appendRow(['WE-' + (jahr - 1) + '-0044']);   // Vorjahr
  ok('zaehlt nur das laufende Jahr weiter',
     ctx.naechsteNummer() === 'WE-' + jahr + '-0010', ctx.naechsteNummer());
}

console.log('\n3) Erfassen');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const r = ctx.weSpeichern({ kunde: 'Kunde AG', lieferant: 'Lief GmbH',
                              lagerM2: 12.5, bemerkung: 'Test', positionen: POS }, u);
  ok('gespeichert', r.ok === true, JSON.stringify(r));

  const w = ss.blaetter.Wareneingang;
  const k = ctx.spalten(w.daten[0]);
  const z = w.daten[1];
  ok('WeNr in der richtigen Spalte', String(z[k.WeNr]).startsWith('WE-'), String(z[k.WeNr]));
  ok('Kunde', z[k.Kunde] === 'Kunde AG');
  ok('Lieferant', z[k.Lieferant] === 'Lief GmbH');
  ok('Angenommen traegt den Namen aus der Sitzung', z[k.AngNam] === 'Anna Muster');
  ok('Angenommen-Datum gesetzt', /^\d{4}-\d{2}-\d{2}$/.test(z[k.AngDat]), String(z[k.AngDat]));
  ok('Angenommen-Zeit gesetzt', /^\d{2}:\d{2}$/.test(z[k.AngZeit]), String(z[k.AngZeit]));
  ok('Gezaehlt bleibt leer', !z[k.GezNam]);
  ok('Status', z[k.Status] === 'angenommen');
  ok('Storniert false', z[k.Storniert] === false);
  ok('LagerM2 als Zahl', z[k.LagerM2] === 12.5);
  ok('Zeile so breit wie die Kopfzeile', z.length === w.daten[0].length,
     z.length + ' statt ' + w.daten[0].length);

  const p = ss.blaetter.Positionen;
  const pk = ctx.spalten(p.daten[0]);
  ok('leere Position weggelassen', p.daten.length === 3, p.daten.length + ' Zeilen');
  ok('fortlaufend ab 1 nummeriert',
     p.daten[1][pk.Nr] === 1 && p.daten[2][pk.Nr] === 2,
     p.daten[1][pk.Nr] + '/' + p.daten[2][pk.Nr]);
  ok('zweite Zeile ist die dritte Eingabe', p.daten[2][pk.Artikel] === 'Kartonage');
  ok('Bestehend als Boolean', p.daten[1][pk.Bestehend] === true);
  ok('Bemerkung in der Position', p.daten[2][pk.Bemerkung] === 'Ecke gedrückt');
  ok('leeres kg bleibt leer', p.daten[2][pk.KG] === '');

  // Der Erfasser quittiert nur, was er selbst getan hat.
  ctx.weSpeichern({ kunde: 'K', positionen: POS,
                    schritte: ['angenommen', 'gezaehlt'] }, u);
  const zwei = w.daten[w.daten.length - 1];
  ok('gewaehlter Schritt quittiert', zwei[k.GezNam] === 'Anna Muster');
  ok('nicht gewaehlter Schritt bleibt leer', !zwei[k.EinNam], String(zwei[k.EinNam]));
  ok('Status ist der weiteste gewaehlte', zwei[k.Status] === 'gezaehlt',
     String(zwei[k.Status]));

  ctx.weSpeichern({ kunde: 'K', positionen: POS, schritte: [] }, u);
  const keins = w.daten[w.daten.length - 1];
  ok('ohne Auswahl bleibt jede Zeile offen',
     !keins[k.AngNam] && !keins[k.GezNam] && !keins[k.EinNam]);
  ok('Status erfasst', keins[k.Status] === 'erfasst', String(keins[k.Status]));

  // Regalplatznr. traegt jetzt auch der Erfasser ein, nicht erst das zweite Team
  ctx.weSpeichern({ kunde: 'K', positionen: [
    { artikel: 'Direkt ins Regal', anzahl: 1, kg: '', mhd: '',
      regalplatz: 'A-01', bemerkung: '', bestehend: false }] }, u);
  ok('Regalplatz schon beim Erfassen',
     p.daten[p.daten.length - 1][pk.Regalplatz] === 'A-01',
     String(p.daten[p.daten.length - 1][pk.Regalplatz]));

  ok('ohne Positionen abgewiesen',
     ctx.weSpeichern({ kunde: 'X', positionen: [] }, u).error === 'keine_positionen');
  ok('ohne Kunde und Lieferant abgewiesen',
     ctx.weSpeichern({ positionen: POS }, u).error === 'kunde_lieferant');
}

console.log('\n4) Quittieren');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const nr = ctx.weSpeichern({ kunde: 'K', positionen: POS }, u).weNr;
  const w = ss.blaetter.Wareneingang, k = ctx.spalten(w.daten[0]);

  const bob = ctx.sitzungPruefen('tokB');
  ok('gezaehlt quittiert', ctx.weSchritt({ weNr: nr, schritt: 'gezaehlt' }, bob).ok === true);
  ok('Name des Quittierenden, nicht des Erfassers', w.daten[1][k.GezNam] === 'Bob Meier');
  ok('Angenommen unveraendert', w.daten[1][k.AngNam] === 'Anna Muster');
  ok('Status nachgefuehrt', w.daten[1][k.Status] === 'gezaehlt');
  ok('zweites Quittieren abgewiesen',
     ctx.weSchritt({ weNr: nr, schritt: 'gezaehlt' }, u).error === 'bereits_quittiert');
  ok('unbekannter Schritt abgewiesen',
     !ctx.weSchritt({ weNr: nr, schritt: 'geloescht' }, u).ok);

  // Regalplaetze folgen der Positionsnummer, nicht der Zeilenreihenfolge
  ctx.weSchritt({ weNr: nr, schritt: 'eingelagert', regalplaetze: ['A-12', 'B-03'] }, u);
  const p = ss.blaetter.Positionen, pk = ctx.spalten(p.daten[0]);
  ok('Regalplatz an Position 1', p.daten[1][pk.Regalplatz] === 'A-12');
  ok('Regalplatz an Position 2', p.daten[2][pk.Regalplatz] === 'B-03');
  ok('Eingelagert quittiert', w.daten[1][k.EinNam] === 'Anna Muster');

  // Wer nur abgetippt hat, laesst die Annahme vom Kollegen quittieren.
  const offen = ctx.weSpeichern({ kunde: 'K', positionen: POS, schritte: [] }, u).weNr;
  ok('Angenommen nachtragbar',
     ctx.weSchritt({ weNr: offen, schritt: 'angenommen' }, bob).ok === true);
  const zOffen = w.daten[w.daten.length - 1];
  ok('Annahme auf den Namen des Kollegen', zOffen[k.AngNam] === 'Bob Meier');
  ok('Status nach dem Nachtragen', zOffen[k.Status] === 'angenommen',
     String(zOffen[k.Status]));

  // Der zuletzt geklickte Schritt darf den Status nicht zurueckwerfen.
  const spaet = ctx.weSpeichern({ kunde: 'K', positionen: POS,
                                  schritte: ['gezaehlt', 'eingelagert'] }, u).weNr;
  ctx.weSchritt({ weNr: spaet, schritt: 'angenommen' }, bob);
  const zSpaet = w.daten[w.daten.length - 1];
  ok('Status faellt nicht zurueck', zSpaet[k.Status] === 'eingelagert',
     String(zSpaet[k.Status]));
}

console.log('\n5) Zuruecknehmen und Liste');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const bob = ctx.sitzungPruefen('tokB');
  const nr = ctx.weSpeichern({ kunde: 'K', positionen: POS }, u).weNr;

  ok('fremdes Zurueckziehen ohne Adminrecht abgelehnt',
     ctx.weStorno({ weNr: nr }, bob).error === 'keine Berechtigung');
  ok('vor dem Storno in der Liste', ctx.weListe({}, u).liste.length === 1);
  ok('Admin darf', ctx.weStorno({ weNr: nr }, u).ok === true);
  ok('danach aus der Liste verschwunden', ctx.weListe({}, u).liste.length === 0);
  ok('Zeile bleibt in der Tabelle', ss.blaetter.Wareneingang.daten.length === 2);
  ok('Quittieren nach Storno abgewiesen',
     ctx.weSchritt({ weNr: nr, schritt: 'gezaehlt' }, u).error === 'storniert');
}

console.log('\n6) CSV — feste Schnittstelle fuer die Excel-Vorlage');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const nr1 = ctx.weSpeichern({ kunde: 'Meier, Sohn & Co', lieferant: 'L', lagerM2: 12.5,
    bemerkung: 'Palette beschädigt',
    positionen: [{ artikel: 'Rohr "40mm"', anzahl: 2, kg: '', mhd: '',
                   bemerkung: '', bestehend: true }] }, u).weNr;
  ctx.weSchritt({ weNr: nr1, schritt: 'gezaehlt' }, u);
  const nr2 = ctx.weSpeichern({ kunde: 'Zweiter', positionen: POS }, u).weNr;
  const nr3 = ctx.weSpeichern({ kunde: 'Weg', positionen: POS }, u).weNr;
  ctx.weStorno({ weNr: nr3 }, u);

  const zeilen = ctx.csvExport().split('\n');
  const kopf = zeilen[0].split(',');

  ok('23 Spalten, feste Reihenfolge', kopf.length === 23, kopf.length + ' Spalten');
  ok('Kopfblock zuerst',
     kopf.slice(0, 5).join(',') === 'WeNr,Kunde,Lieferant,LagerM2,KopfBemerkung',
     kopf.slice(0, 5).join(','));
  ok('alle drei Quittungen mit Datum und Zeit',
     kopf.slice(5, 14).join(',') ===
     'AngNam,AngDat,AngZeit,GezNam,GezDat,GezZeit,EinNam,EinDat,EinZeit',
     kopf.slice(5, 14).join(','));
  ok('Positionsblock danach',
     kopf.slice(14, 22).join(',') ===
     'Nr,Artikel,Anzahl,KG,MHD,Regalplatz,Bemerkung,Bestehend',
     kopf.slice(14, 22).join(','));
  ok('Schluessel als letzte Spalte', kopf[22] === 'Schluessel', kopf[22]);

  ok('eine Zeile je Position, storniert faellt weg',
     zeilen.length === 1 + 1 + 2, zeilen.length + ' Zeilen');
  ok('Komma im Feld wird gequotet', zeilen[1].includes('"Meier, Sohn & Co"'));
  ok('Anfuehrungszeichen verdoppelt', zeilen[1].includes('"Rohr ""40mm"""'), zeilen[1]);
  ok('Bestehend als X', felder(zeilen[1])[21] === 'X');
  ok('Kopfdaten wiederholen sich je Zeile',
     zeilen[2].startsWith(nr2 + ',Zweiter') && zeilen[3].startsWith(nr2 + ',Zweiter'),
     zeilen[2] + ' / ' + zeilen[3]);
  const f = felder(zeilen[1]);
  ok('23 Felder auch mit Komma im Text', f.length === 23, f.length + ' Felder');
  ok('Kunde mit Komma bleibt ein Feld', f[1] === 'Meier, Sohn & Co', f[1]);
  ok('LagerM2 im Kopfblock', f[3] === '12.5', f[3]);
  ok('KopfBemerkung im Kopfblock', f[4] === 'Palette beschädigt', f[4]);
  ok('Gezaehlt-Datum gefuellt', /^\d{4}-\d{2}-\d{2}$/.test(f[9]), f[9]);
  ok('Eingelagert bleibt leer', f[11] === '');
  ok('Artikel mit Anfuehrungszeichen', f[15] === 'Rohr "40mm"', f[15]);
  ok('Schluessel ist WeNr-Nr', f[22] === nr1 + '-1', f[22]);
  ok('Schluessel je Position verschieden',
     felder(zeilen[2])[22] === nr2 + '-1' && felder(zeilen[3])[22] === nr2 + '-2',
     felder(zeilen[2])[22] + ' / ' + felder(zeilen[3])[22]);

  // ?we= — genau ein Wareneingang, fuer das Formularblatt
  const eins = ctx.csvExport({ we: nr2 }).split('\n');
  ok('we-Filter liefert nur diesen Wareneingang', eins.length === 3, eins.length + ' Zeilen');
  ok('we-Filter behaelt die Kopfzeile', eins[0] === zeilen[0]);
  ok('we-Filter auf Stornierten liefert nur die Kopfzeile',
     ctx.csvExport({ we: nr3 }).split('\n').length === 1);
  ok('unbekannte Nummer liefert nur die Kopfzeile',
     ctx.csvExport({ we: 'WE-1999-0001' }).split('\n').length === 1);

  // ?tage= — Fenster, damit die Arbeitsmappe klein bleibt
  const w = ss.blaetter.Wareneingang, wk = ctx.spalten(w.daten[0]);
  w.daten[1][wk.AngDat] = '2020-01-01';                  // alt
  ok('tage-Fenster laesst Altes weg',
     ctx.csvExport({ tage: 30 }).split('\n').length === 3,
     ctx.csvExport({ tage: 30 }).split('\n').length + ' Zeilen');
  ok('ohne tage kommt alles', ctx.csvExport().split('\n').length === 4);
}

console.log('\n7) Benutzerverwaltung');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const bob = ctx.sitzungPruefen('tokB');

  ok('Nicht-Admin wird abgewiesen',
     ctx.verteilen({ session: 'tokB', action: 'admin_liste' }).error === 'keine Berechtigung');
  ok('Admin darf', ctx.verteilen({ session: 'tokA', action: 'admin_liste' }).ok === true);
  ok('sich selbst deaktivieren geht nicht',
     ctx.adminAktion({ email: 'anna@firma.ch', was: 'aus' }, u).error === 'nicht_selbst');
  ok('sich selbst entrechten geht nicht',
     ctx.adminAktion({ email: 'anna@firma.ch', was: 'kein_admin' }, u).error === 'nicht_selbst');
  ok('anderen deaktivieren geht',
     ctx.adminAktion({ email: 'bob@firma.ch', was: 'aus' }, u).ok === true);
  ok('Deaktivierung beendet die Sitzung sofort',
     ctx.sitzungPruefen('tokB') === null);
  ok('doppelte E-Mail abgewiesen',
     ctx.adminNeu({ email: 'bob@firma.ch', name: 'X' }, u).error === 'existiert');
}

console.log('\n8) Sitzung');
{
  const ss = neueTabelle(), ctx = laden(ss);
  mitBenutzer(ctx, ss);
  ok('unbekanntes Token', ctx.sitzungPruefen('nix') === null);
  ok('leeres Token', ctx.sitzungPruefen('') === null);
  ss.blaetter.Sessions.appendRow(['alt', 'anna@firma.ch', new Date(Date.now() - 1000)]);
  ok('abgelaufenes Token', ctx.sitzungPruefen('alt') === null);
  ok('ohne Sitzung keine Aktion',
     ctx.verteilen({ session: 'nix', action: 'we_liste' }).error === 'session');

  // Vor dem Passwortwechsel ist alles ausser dem Wechsel gesperrt
  const b = ss.blaetter.Benutzer, k = ctx.spalten(b.daten[0]);
  b.daten[1][k.PwGeaendert] = false;
  ok('erzwungener Passwortwechsel blockiert',
     ctx.verteilen({ session: 'tokA', action: 'we_liste' }).error === 'passwort_noetig');
  ok('der Wechsel selbst geht durch',
     ctx.verteilen({ session: 'tokA', action: 'passwort', alt: '', neu: 'kurz' })
        .error === 'zu_kurz');
}

console.log('\n9) Einstellungen im Adminbereich');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const bob = ctx.sitzungPruefen('tokB');

  const leer = ctx.adminParameter({}, u);
  ok('anfangs alle drei leer',
     leer.werte.MailAn === '' && leer.werte.ArchivOrdner === '' &&
     leer.werte.FotoOrdner === '', JSON.stringify(leer.werte));

  // Wer den Ordner offen hat, kopiert die Adresse - nicht die ID darin.
  const r = ctx.adminParameter({ werte: {
    MailAn: ' lager@firma.ch ',
    ArchivOrdner: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz09/',
    FotoOrdner: '1FotoFotoFotoFotoFotoFotoFo'
  } }, u);
  ok('Mail getrimmt gespeichert', r.werte.MailAn === 'lager@firma.ch', r.werte.MailAn);
  ok('Ordner-ID aus der Adresse geholt',
     r.werte.ArchivOrdner === '1AbCdEfGhIjKlMnOpQrStUvWxYz09', r.werte.ArchivOrdner);
  ok('blosse ID bleibt, wie sie ist',
     r.werte.FotoOrdner === '1FotoFotoFotoFotoFotoFotoFo', r.werte.FotoOrdner);
  ok('Ordnername kommt mit', r.ordner.ArchivOrdner.startsWith('Ordner '),
     r.ordner.ArchivOrdner);

  // Der Wert steht wirklich im Blatt und wird von parameter() gefunden
  ok('MailAn im Blatt Parameter', ctx.parameter('MailAn') === 'lager@firma.ch');
  const par = ss.blaetter.Parameter;
  ok('keine Zeile doppelt angelegt',
     par.daten.filter(z => z[0] === 'MailAn').length === 1,
     JSON.stringify(par.daten));

  ctx.adminParameter({ werte: { MailAn: 'neu@firma.ch' } }, u);
  ok('zweites Speichern ueberschreibt', ctx.parameter('MailAn') === 'neu@firma.ch');
  ok('nicht mitgeschickte Werte bleiben stehen',
     ctx.parameter('FotoOrdner') === '1FotoFotoFotoFotoFotoFotoFo');

  ok('unsinnige Adresse abgewiesen',
     ctx.adminParameter({ werte: { MailAn: 'lager.firma.ch' } }, u).error === 'mail_ungueltig');
  ok('nach der Abweisung steht der alte Wert', ctx.parameter('MailAn') === 'neu@firma.ch');

  const kaputt = ctx.adminParameter({ werte: { ArchivOrdner: 'kaputt-kaputt-kaputt-kaputt' } }, u);
  ok('unerreichbarer Ordner ohne Namen', kaputt.ordner.ArchivOrdner === '',
     kaputt.ordner.ArchivOrdner);

  // Rechte: die Pruefung sitzt in verteilen(), nicht in der Oberflaeche
  ok('Nicht-Admin abgewiesen',
     ctx.verteilen({ action: 'admin_parameter', session: 'tokB' }).error === 'keine Berechtigung');
  ok('Admin kommt durch',
     ctx.verteilen({ action: 'admin_parameter', session: 'tokA' }).ok === true);
}

console.log('\n10) Excel-Blatt');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const nr = ctx.weSpeichern({ kunde: 'Kunde AG', lieferant: 'Lief GmbH',
                               lagerM2: 12.5, positionen: POS }, u).weNr;
  ctx.weSchritt({ weNr: nr, schritt: 'gezaehlt' }, u);
  const det = ctx.weDetail({ weNr: nr }, u);

  const sh = new Sheet('leer');
  ctx.blattAufbauen(sh, det.kopf, det.positionen);
  const zelle = (r, c) => (sh.daten[r - 1] || [])[c - 1];

  ok('Titel in A1', String(zelle(1, 1)).startsWith('Wareneingang / Material reception'));
  // Der Ausdruck wird unterschrieben und abgelegt — ohne Nummer weiss
  // niemand, zu welcher Lieferung das Blatt gehoert.
  ok('WE-Nummer im Kopf', String(zelle(1, 6)).startsWith('WE-'), String(zelle(1, 6)));
  ok('Quittungskopf in Zeile 3', zelle(3, 1) === 'Aufgabe / Task');
  ok('Angenommen mit Namen', zelle(4, 3) === 'Anna Muster');
  ok('Gezaehlt mit Namen', zelle(5, 3) === 'Anna Muster');
  ok('Eingelagert leer', zelle(6, 3) === '');
  ok('Datum der Quittung in Spalte E', /^\d{4}-\d{2}-\d{2}$/.test(String(zelle(4, 5))),
     String(zelle(4, 5)));
  ok('Uhrzeit der Quittung in Spalte F', /^\d{2}:\d{2}$/.test(String(zelle(4, 6))),
     String(zelle(4, 6)));
  ok('Kunde in A10/C10', zelle(10, 1) === 'Kunde / Client' && zelle(10, 3) === 'Kunde AG');
  ok('Lieferant in Zeile 11', zelle(11, 3) === 'Lief GmbH');

  // Ohne die Verbindungen stehen die langen Beschriftungen in der 60px
  // schmalen N°-Spalte und werden abgeschnitten.
  const verbunden = (z, s, n) => sh.verbunden.some(v =>
    v.zeile === z && v.spalte === s && v.spalten === n && v.zeilen === 1);
  ok('Aufgabenspalte verbunden A:B', [3, 4, 5, 6].every(z => verbunden(z, 1, 2)),
     JSON.stringify(sh.verbunden));
  ok('Namensspalte verbunden C:D', [3, 4, 5, 6].every(z => verbunden(z, 3, 2)));
  ok('Hinweis ueber die ganze Breite', verbunden(8, 1, 8) && verbunden(13, 1, 8));
  ok('Kunde und Lieferant verbunden',
     verbunden(10, 1, 2) && verbunden(10, 3, 4) &&
     verbunden(11, 1, 2) && verbunden(11, 3, 4));
  ok('Positionskopf in Zeile 15', zelle(15, 1) === 'N°');
  ok('achte Spalte ist Bestehend', String(zelle(15, 8)).startsWith('Bestehend'));
  ok('erste Position in Zeile 16', zelle(16, 2) === 'Schrauben M6');
  ok('Anzahl in Spalte C', zelle(16, 3) === 120);
  ok('kg in Spalte D', zelle(16, 4) === 3.4);
  ok('Bestehend als X', zelle(16, 8) === 'X');
  ok('zweite Position in Zeile 17', zelle(17, 2) === 'Kartonage');
  ok('nicht bestehend bleibt leer', zelle(17, 8) === '');
  // Fuenf Zeilen wie auf dem Papier, dann eine Leerzeile, dann der Fuss
  ok('auf 5 Zeilen aufgefuellt', zelle(20, 1) === '' && sh.daten.length >= 20);
  ok('Fussbereich nach den Positionen',
     zelle(22, 1) === 'Lagerfläche / storage space', String(zelle(22, 1)));
  ok('m2-Wert im Fuss', zelle(23, 3) === 12.5);
  ok('Umrechnung im Fuss', zelle(23, 4) === '1 g = 0.001 kg');

  // Mehr Positionen als das Papier: der Fuss muss mitwandern
  const viele = [];
  for (let i = 0; i < 9; i++) viele.push({ nr: i + 1, artikel: 'A' + i,
    anzahl: 1, kg: '', mhd: '', regalplatz: '', bemerkung: '', bestehend: false });
  const sh2 = new Sheet('leer');
  ctx.blattAufbauen(sh2, det.kopf, viele);
  const z2 = (r, c) => (sh2.daten[r - 1] || [])[c - 1];
  ok('neunte Position in Zeile 24', z2(24, 2) === 'A8');
  ok('Fuss wandert auf Zeile 26', z2(26, 1) === 'Lagerfläche / storage space');
}

console.log('\n11) Umgedeutete Datums- und Zeitwerte');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const nr = ctx.weSpeichern({ kunde: 'K', positionen: POS }, u).weNr;

  // Genau das, was eine Tabelle ohne Textformat zurueckgibt: aus «08:30»
  // wurde eine Uhrzeit am 30.12.1899, aus «2026-09-09» ein Datum.
  const w = ss.blaetter.Wareneingang, k = ctx.spalten(w.daten[0]);
  w.daten[1][k.AngDat]  = new Date(2026, 8, 9);
  w.daten[1][k.AngZeit] = new Date(1899, 11, 30, 17, 3);
  const p = ss.blaetter.Positionen, pk = ctx.spalten(p.daten[0]);
  p.daten[1][pk.MHD] = new Date(2027, 9, 1);

  const det = ctx.weDetail({ weNr: nr }, u);
  ok('Datum wieder als Datum', det.kopf.AngDat === '2026-09-09', det.kopf.AngDat);
  ok('Uhrzeit wieder als Uhrzeit', det.kopf.AngZeit === '17:03', det.kopf.AngZeit);
  ok('MHD wieder als Datum', det.positionen[0].mhd === '2027-10-01',
     det.positionen[0].mhd);

  const liste = ctx.weListe({}, u).liste[0];
  ok('Liste zeigt kein 1899', liste.zeit === '17:03', liste.zeit);

  const zeilen = ctx.csvExport().split('\n');
  const kopfCsv = felder(zeilen[0]), erste = felder(zeilen[1]);
  ok('CSV liefert die Uhrzeit als Text',
     erste[kopfCsv.indexOf('AngZeit')] === '17:03',
     erste[kopfCsv.indexOf('AngZeit')]);
  ok('CSV liefert das Datum als Text',
     erste[kopfCsv.indexOf('AngDat')] === '2026-09-09',
     erste[kopfCsv.indexOf('AngDat')]);
  ok('CSV laesst Zahlen in Ruhe',
     erste[kopfCsv.indexOf('Anzahl')] === '120', erste[kopfCsv.indexOf('Anzahl')]);
}

console.log('\n12) Einrichtung — Textspalten');
{
  const ZEIT = ['AngDat', 'AngZeit', 'GezDat', 'GezZeit', 'EinDat', 'EinZeit'];

  const ss = neueTabelle(), ctx = laden(ss);
  // Ueber die alte Grenze von 5000 Zeilen hinaus: dort hoerte das Format auf,
  // und ab da fing Sheets an, die Strings wieder als Datum zu lesen.
  for (let i = 0; i < 6000; i++) {
    ss.blaetter.Wareneingang.daten.push([]);
    ss.blaetter.Positionen.daten.push([]);
  }
  ctx.setupAnlegen();

  const textSpalte = (blatt, name) => {
    const bl = ss.blaetter[blatt];
    const k  = ctx.spalten(bl.daten[0]);
    return bl.formate.some(f => f.format === '@' && f.spalte === k[name] + 1 &&
                                f.zeile === 2 && f.zeilen >= bl.getMaxRows() - 1);
  };

  // Ohne Textformat macht Sheets aus «2026-09-09» ein Datum und aus «08:30»
  // eine Uhrzeit; zurueck kommt dann ein Zeitstempel, der so in der Liste,
  // in der CSV und im Excel-Formular landet.
  ZEIT.forEach(name =>
    ok(name + ' als Text, ueber das ganze Blatt', textSpalte('Wareneingang', name)));
  ok('MHD als Text, ueber das ganze Blatt', textSpalte('Positionen', 'MHD'));

  // Die Spalten werden ueber ihre Namen gefunden, nicht ueber feste Nummern —
  // sonst formatiert eine umgestellte Tabelle die falschen Spalten.
  const ss2 = neueTabelle(), ctx2 = laden(ss2);
  const w2 = ss2.blaetter.Wareneingang;
  w2.daten[0] = w2.daten[0].slice().reverse();
  ctx2.setupAnlegen();
  const k2 = ctx2.spalten(w2.daten[0]);
  const daneben = ZEIT.filter(name =>
    !w2.formate.some(f => f.format === '@' && f.spalte === k2[name] + 1));
  ok('Textformat folgt der umgestellten Spalte', daneben.length === 0,
     'ohne Format: ' + daneben.join(', '));
}

console.log('\n13) Zufall, Sitzung, Sperre');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

  const viele = [];
  for (let i = 0; i < 200; i++) viele.push(ctx.zufall(32));
  ok('richtige Laenge', viele.every(s => s.length === 32));
  ok('nur Zeichen aus dem Alphabet',
     viele.every(s => Array.from(s).every(c => ALPHABET.includes(c))));
  ok('keine Verwechslerzeichen', !viele.join('').match(/[0O1lI]/));
  ok('alle verschieden', new Set(viele).size === 200);

  // Beweist die Quelle: waere noch Math.random() im Spiel, aenderte ein
  // festgenageltes getUuid nichts an der Ausgabe.
  const echt = ctx.Utilities.getUuid;
  ctx.Utilities.getUuid = () => '00112233-4455-6677-8899-aabbccddeeff';
  const a = ctx.zufall(20), b = ctx.zufall(20);
  ctx.Utilities.getUuid = echt;
  ok('Zufall stammt aus getUuid', a === b && a.length === 20, a + ' / ' + b);

  // Anmeldung: der Weg war bisher gar nicht gefahren
  const bl = ss.blaetter.Benutzer, k = ctx.spalten(bl.daten[0]);
  const salt = ctx.zufall(16);
  bl.appendRow(['eva@firma.ch', 'Eva Weber', ctx.hash('geheim123', salt), salt,
                true, 0, '', '', true, '']);
  const an = ctx.login({ email: ' Eva@Firma.CH ', passwort: 'geheim123' });
  ok('Anmeldung mit Gross- und Kleinschreibung', an.ok === true, JSON.stringify(an));
  ok('Sitzung angelegt', ss.blaetter.Sessions.daten.some(z => z[0] === an.session));
  ok('falsches Passwort abgewiesen',
     ctx.login({ email: 'eva@firma.ch', passwort: 'falsch' }).error === 'login');

  // Abmelden raeumt den Token weg, nicht nur den Browser
  ok('abmelden bestaetigt', ctx.verteilen({ action: 'abmelden', session: an.session }).ok === true);
  ok('Token geloescht', !ss.blaetter.Sessions.daten.some(z => z[0] === an.session));
  ok('Sitzung danach ungueltig', ctx.sitzungPruefen(an.session) === null);

  // Abgelaufene Zeilen verschwinden beim naechsten Anmelden
  ss.blaetter.Sessions.appendRow(['alt1', 'eva@firma.ch', new Date(Date.now() - 8.64e7)]);
  ss.blaetter.Sessions.appendRow(['alt2', 'eva@firma.ch', new Date(Date.now() - 1)]);
  const vorher = ss.blaetter.Sessions.daten.length;
  ctx.login({ email: 'eva@firma.ch', passwort: 'geheim123' });
  ok('abgelaufene Sitzungen aufgeraeumt',
     ss.blaetter.Sessions.daten.length === vorher - 1,
     vorher + ' -> ' + ss.blaetter.Sessions.daten.length);

  // Quittieren unter Sperre, wie das Erfassen
  const u = mitBenutzer(ctx, ss);
  const nr = ctx.weSpeichern({ kunde: 'K', positionen: POS }, u).weNr;
  ctx.__sperren.length = 0;
  ctx.weSchritt({ weNr: nr, schritt: 'gezaehlt' }, u);
  ok('Quittieren nimmt die Sperre',
     ctx.__sperren.join(',') === 'an,aus', ctx.__sperren.join(','));
  ctx.__sperren.length = 0;
  ctx.weSchritt({ weNr: nr, schritt: 'gezaehlt' }, u);
  ok('Sperre auch bei Abweisung wieder frei',
     ctx.__sperren.join(',') === 'an,aus', ctx.__sperren.join(','));
}

console.log('\n14) Doppelte Erfassung');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const w = ss.blaetter.Wareneingang;
  const eingabe = () => ({ kunde: 'K', positionen: POS, vorgang: 'v-4711' });

  const erst = ctx.weSpeichern(eingabe(), u);
  const nochmal = ctx.weSpeichern(eingabe(), u);
  ok('zweiter Versuch legt nichts an', w.daten.length === 2, w.daten.length + ' Zeilen');
  ok('dieselbe Nummer zurueck', nochmal.weNr === erst.weNr,
     erst.weNr + ' / ' + nochmal.weNr);
  ok('als Wiederholung gekennzeichnet', nochmal.wiederholt === true);
  ok('keine doppelten Positionen', ss.blaetter.Positionen.daten.length === 3,
     ss.blaetter.Positionen.daten.length + ' Zeilen');

  const anderer = ctx.weSpeichern({ kunde: 'K', positionen: POS, vorgang: 'v-4712' }, u);
  ok('anderer Vorgang legt an', anderer.weNr !== erst.weNr && w.daten.length === 3);
  ok('Schluessel steht in der Zeile',
     w.daten[1][ctx.spalten(w.daten[0]).Vorgang] === 'v-4711',
     String(w.daten[1][ctx.spalten(w.daten[0]).Vorgang]));

  // Ohne Schluessel bleibt es beim alten Verhalten
  ctx.weSpeichern({ kunde: 'K', positionen: POS }, u);
  ctx.weSpeichern({ kunde: 'K', positionen: POS }, u);
  ok('ohne Schluessel wird nicht zusammengelegt', w.daten.length === 5,
     w.daten.length + ' Zeilen');

  // Komma statt Punkt: der Server rechnet selbst um
  ctx.weSpeichern({ kunde: 'K', lagerM2: '12,5', vorgang: 'v-komma', positionen: [
    { artikel: 'Mit Komma', anzahl: '3,4', kg: ' 1,25 ', mhd: '', bemerkung: '',
      bestehend: false },
    { artikel: 'Unsinn', anzahl: 'viele', kg: '', mhd: '', bemerkung: '',
      bestehend: false }] }, u);
  const k = ctx.spalten(w.daten[0]);
  const p = ss.blaetter.Positionen, pk = ctx.spalten(p.daten[0]);
  ok('Komma im m2-Feld', w.daten[w.daten.length - 1][k.LagerM2] === 12.5);
  ok('Komma in der Anzahl', p.daten[p.daten.length - 2][pk.Anzahl] === 3.4,
     String(p.daten[p.daten.length - 2][pk.Anzahl]));
  ok('Komma mit Leerzeichen im kg', p.daten[p.daten.length - 2][pk.KG] === 1.25);
  ok('unsinnige Zahl wird leer, nicht NaN',
     p.daten[p.daten.length - 1][pk.Anzahl] === '',
     String(p.daten[p.daten.length - 1][pk.Anzahl]));
}

console.log('\n15) Sicherung und Nachruesten');
{
  const ss = neueTabelle(), ctx = laden(ss);
  ok('ohne Ordner wird nicht gesichert',
     ctx.sicherung() === 'kein SicherungOrdner gesetzt — nichts gesichert');
  ctx.parameterSetzen('SicherungOrdner', '1SicherungSicherungSicherung');
  ok('mit eigenem Ordner wird gesichert', ctx.sicherung() === 'gesichert');
  ok('Archivordner bleibt aussen vor', ctx.parameter('ArchivOrdner') === '');

  // Bestehende Tabelle ohne die neue Spalte: setupAnlegen zieht sie nach
  const alt = neueTabelle(), ctx2 = laden(alt);
  const w = alt.blaetter.Wareneingang;
  w.daten[0] = w.daten[0].filter(s => s !== 'Vorgang');
  w.appendRow(['WE-2026-0001']);
  ctx2.setupAnlegen();
  ok('fehlende Spalte hinten angehaengt',
     w.daten[0][w.daten[0].length - 1] === 'Vorgang', JSON.stringify(w.daten[0]));
  ok('vorhandene Daten unberuehrt', w.daten[1][0] === 'WE-2026-0001');
  ok('nichts doppelt angelegt',
     w.daten[0].filter(s => s === 'Vorgang').length === 1);
}

console.log('\n16) Konfiguration in den Skripteigenschaften');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const text = r => (typeof r === 'string' ? r : r.t);
  const frisch = () => { ctx.eigenschaft._alle = null; };
  ctx.console = { log: () => {}, error: () => {} };   // Berichte nicht mitdrucken

  const ID = '1TabelleTabelleTabelleTabelleTabelle';
  ok('Wert kommt aus den Eigenschaften', ctx.eigenschaft('SHEET_ID') === ID);
  ok('PWA-Adresse steht im Zugangsmail',
     ctx.zugangText('Eva', 'Pass1234').includes('https://wareneingang.example/'));

  // Fehlt ein Wert, muss die Meldung sagen, wo er hingehoert — sonst sucht
  // man ihn im Code, wo er seit dieser Version nicht mehr steht.
  ctx.__eigenschaften.SHEET_ID = '';
  frisch();
  let meldung = '';
  try { ctx.blatt('Wareneingang'); } catch (e) { meldung = e.message; }
  ok('fehlender Wert wird benannt',
     meldung.includes('SHEET_ID') && meldung.includes('Skripteigenschaften'), meldung);
  ok('leerer Wert darf leer sein, wenn erlaubt',
     ctx.eigenschaft('SHEET_ID', true) === '');
  ctx.__eigenschaften.SHEET_ID = ID;
  frisch();

  // Wer die Tabelle offen hat, kopiert die Adresse aus der Leiste. Das darf
  // kein «Invalid argument: id» geben — der haeufigste Einrichtungsfehler.
  ctx.__eigenschaften.SHEET_ID =
    'https://docs.google.com/spreadsheets/d/' + ID + '/edit?gid=0#gid=0';
  frisch();
  ok('ganze Adresse statt ID wird angenommen',
     ctx.tabelle().getName() === 'Wareneingang (Test)');
  ok('Bericht zeigt die daraus geholte ID',
     ctx.einrichtungPruefen().includes('daraus die ID: ' + ID));

  // Eine wirklich falsche ID muss sagen, welche Eigenschaft gemeint ist
  ctx.__eigenschaften.SHEET_ID = 'nur-ein-wort';
  frisch();
  let kaputt = '';
  try { ctx.blatt('Wareneingang'); } catch (e) { kaputt = e.message; }
  ok('falsche ID nennt Eigenschaft und Wert',
     kaputt.includes('SHEET_ID') && kaputt.includes('nur-ein-wort') &&
     kaputt.includes('/d/'), kaputt);

  ctx.__eigenschaften.SHEET_ID = ID;
  frisch();

  // CSV-Ausgang haengt am Token aus den Eigenschaften
  const csv = text(ctx.doGet({ parameter: { format: 'csv', token: 'geheimwort' } }));
  ok('richtiges Token liefert die CSV', csv.split('\n')[0].startsWith('WeNr,'), csv.slice(0, 40));
  ok('falsches Token wird abgewiesen',
     text(ctx.doGet({ parameter: { format: 'csv', token: 'falsch' } })) === 'kein Zugriff');
  ok('ohne Token wird abgewiesen',
     text(ctx.doGet({ parameter: { format: 'csv' } })) === 'kein Zugriff');

  ctx.__eigenschaften.TOKEN_READ = '';
  frisch();
  ok('ohne hinterlegtes Token bleibt der Ausgang zu',
     text(ctx.doGet({ parameter: { format: 'csv', token: '' } })) === 'kein Zugriff');

  // tokenErzeugen legt ein starkes Token ab und macht den Cache frei
  const neu = ctx.tokenErzeugen();
  ok('Token erzeugt und gespeichert',
     neu.length === 24 && ctx.__eigenschaften.TOKEN_READ === neu, neu);
  ok('neues Token gilt sofort',
     text(ctx.doGet({ parameter: { format: 'csv', token: neu } })).startsWith('WeNr,'));

  // Der Bericht sagt, was fehlt
  ctx.__eigenschaften.PWA_URL = '';
  const bericht = ctx.einrichtungPruefen();
  ok('Bericht meldet die fehlende Adresse', bericht.includes('PWA_URL: FEHLT'), bericht);
  ok('Bericht nennt die Tabelle', bericht.includes('Wareneingang (Test)'));
  ok('Bericht nennt die CSV-Adresse', bericht.includes('&format=csv&tage=365'));
  ok('Bericht meldet vollstaendige Blaetter', bericht.includes('alle sieben da'), bericht);

  delete ss.blaetter.Sessions;
  ok('Bericht meldet fehlende Blaetter',
     ctx.einrichtungPruefen().includes('Blaetter FEHLEN: Sessions'));
}

console.log('\n17) Anmeldung verraet nichts, Sperre gibt neue Versuche');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const bl = ss.blaetter.Benutzer, k = ctx.spalten(bl.daten[0]);
  const salt = ctx.zufall(16);
  const neu = (email, aktiv) => bl.appendRow(
    [email, 'Eva Weber', ctx.hash('geheim123', salt), salt, aktiv, 0, '', '', true, '']);
  neu('eva@firma.ch', true);
  neu('aus@firma.ch', false);

  // Wer das Passwort nicht kennt, darf nicht erfahren, ob es das Konto gibt
  ok('unbekanntes Konto: login',
     ctx.login({ email: 'niemand@firma.ch', passwort: 'egal12345' }).error === 'login');
  ok('deaktiviertes Konto ohne Passwort: login',
     ctx.login({ email: 'aus@firma.ch', passwort: 'falsch' }).error === 'login');
  ok('deaktiviertes Konto mit Passwort: inaktiv',
     ctx.login({ email: 'aus@firma.ch', passwort: 'geheim123' }).error === 'inaktiv');

  // Fuenf Fehlversuche sperren, auch das richtige Passwort kommt nicht durch
  for (let i = 0; i < 5; i++) ctx.login({ email: 'eva@firma.ch', passwort: 'falsch' });
  const zeile = bl.daten.findIndex(z => z[k.Email] === 'eva@firma.ch');
  ok('nach fuenf Fehlversuchen gesperrt', !!bl.daten[zeile][k.GesperrtBis]);
  ok('richtiges Passwort meldet die Sperre',
     ctx.login({ email: 'eva@firma.ch', passwort: 'geheim123' }).error === 'gesperrt');
  ok('falsches Passwort verraet die Sperre nicht',
     ctx.login({ email: 'eva@firma.ch', passwort: 'falsch' }).error === 'login');

  // Abgelaufene Sperre: der Zaehler faengt von vorn an, sonst sperrt der
  // erste Tippfehler nach der Wartezeit sofort erneut
  bl.daten[zeile][k.GesperrtBis] = new Date(Date.now() - 60000);
  ok('nach Ablauf zaehlt es neu',
     ctx.login({ email: 'eva@firma.ch', passwort: 'falsch' }).error === 'login');
  ok('Zaehler steht wieder bei eins', Number(bl.daten[zeile][k.Fehler]) === 1,
     String(bl.daten[zeile][k.Fehler]));
  ok('und die Sperre ist weg', !bl.daten[zeile][k.GesperrtBis]);
  ok('anmelden geht wieder',
     ctx.login({ email: 'eva@firma.ch', passwort: 'geheim123' }).ok === true);
}

console.log('\n18) Passwort-Hash mit Runden');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const bl = ss.blaetter.Benutzer, k = ctx.spalten(bl.daten[0]);
  const salt = ctx.zufall(16);

  ok('neuer Hash traegt die Marke', ctx.hash('geheim123', salt).indexOf('v2$') === 0);
  ok('gleiches Passwort, gleicher Hash',
     ctx.hash('geheim123', salt) === ctx.hash('geheim123', salt));
  ok('anderes Salz, anderer Hash', ctx.hash('geheim123', ctx.zufall(16))
     !== ctx.hash('geheim123', salt));

  // Die alte Fassung — ein einziger Durchgang, ohne Marke — muss weiter
  // gelten, sonst sperrt diese Aenderung alle aus.
  const alt = ctx.digest(salt + 'geheim123');
  ok('alte Fassung wird angenommen', ctx.hashPasst('geheim123', salt, alt) === true);
  ok('alte Fassung, falsches Passwort', ctx.hashPasst('falsch', salt, alt) === false);

  bl.appendRow(['eva@firma.ch', 'Eva', alt, salt, true, 0, '', '', true, '']);
  ok('anmelden mit altem Hash',
     ctx.login({ email: 'eva@firma.ch', passwort: 'geheim123' }).ok === true);
  const zeile = bl.daten.findIndex(z => z[k.Email] === 'eva@firma.ch');
  ok('Hash im Vorbeigehen ersetzt',
     String(bl.daten[zeile][k.PassHash]).indexOf('v2$') === 0,
     String(bl.daten[zeile][k.PassHash]).slice(0, 12));
  ok('danach gilt die neue Fassung',
     ctx.login({ email: 'eva@firma.ch', passwort: 'geheim123' }).ok === true);
}

console.log('\n19) Suche, GET, Foto, Versandvermerk');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  const bob = ctx.sitzungPruefen('tokB');

  const meins = ctx.weSpeichern({ kunde: 'Meier AG', lieferant: 'Wenger',
                                  positionen: POS }, u).weNr;
  const bobs = ctx.weSpeichern({ kunde: 'Alpina Food', lieferant: 'Nordwind',
                                 positionen: POS, schritte: ['angenommen'] }, bob).weNr;
  ctx.weSchritt({ weNr: bobs, schritt: 'gezaehlt' }, bob);
  ctx.weSchritt({ weNr: bobs, schritt: 'eingelagert' }, bob);
  const weg = ctx.weSpeichern({ kunde: 'Storniert AG', positionen: POS }, u).weNr;
  ctx.weStorno({ weNr: weg }, u);

  // Ohne Suche bleibt der abgeschlossene Eintrag des Kollegen aussen vor
  const offen = ctx.weListe({}, u).liste.map(x => x.weNr);
  ok('eigener Eintrag in der Liste', offen.indexOf(meins) >= 0);
  ok('fremder abgeschlossener nicht', offen.indexOf(bobs) < 0, JSON.stringify(offen));

  // Mit Suche schon — sonst waere ein alter Beleg aus der App unerreichbar
  const treffer = s => ctx.weListe({ suche: s }, u).liste.map(x => x.weNr);
  ok('Suche findet den fremden Eintrag', treffer('alpina').indexOf(bobs) >= 0);
  ok('Suche ist unabhaengig von Gross- und Kleinschreibung',
     treffer('ALPINA').indexOf(bobs) >= 0);
  ok('Suche ueber die Nummer', treffer(meins).indexOf(meins) >= 0);
  ok('Suche ueber den Lieferanten', treffer('nordwind').indexOf(bobs) >= 0);
  ok('Suche ueber den Erfasser', treffer('bob meier').indexOf(bobs) >= 0);
  ok('Storniertes bleibt auch in der Suche weg', treffer('storniert').length === 0);
  ok('nichts gefunden gibt eine leere Liste', treffer('gibtsnicht').length === 0);

  // GET fuehrt keine Aktionen mehr aus — kein Token in einer Adresse
  const antwort = ctx.doGet({ parameter: { action: 'we_liste', session: 'tokA' } });
  const text = typeof antwort === 'string' ? antwort : antwort.t;
  ok('GET ohne format=csv fuehrt nichts aus', text.indexOf('nur den CSV-Export') >= 0, text);

  // Endung nach Bildtyp
  ctx.parameterSetzen('FotoOrdner', '1FotoFotoFotoFotoFotoFotoFo');
  ctx.__dateien.length = 0;
  ctx.weSpeichern({ kunde: 'Mit Bild', positionen: POS,
                    foto: 'data:image/png;base64,QUJD' }, u);
  ok('PNG bekommt die Endung png',
     String(ctx.__dateien[0]).endsWith('_Lieferschein.png'), String(ctx.__dateien[0]));
  ctx.__dateien.length = 0;
  ctx.weSpeichern({ kunde: 'Mit Bild', positionen: POS,
                    foto: 'data:image/jpeg;base64,QUJD' }, u);
  ok('JPEG bleibt jpg',
     String(ctx.__dateien[0]).endsWith('_Lieferschein.jpg'), String(ctx.__dateien[0]));

  // Versandvermerk landet in der richtigen Zeile
  ctx.parameterSetzen('MailAn', 'lager@firma.ch');
  ok('Versand bestaetigt', ctx.weSenden({ weNr: meins }, u).ok === true);
  const w = ss.blaetter.Wareneingang, k = ctx.spalten(w.daten[0]);
  const zeile = w.daten.find(z => z[k.WeNr] === meins);
  ok('Gesendet vermerkt', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(zeile[k.Gesendet])),
     String(zeile[k.Gesendet]));
  ok('Vermerk steht in der Liste',
     ctx.weListe({ suche: meins }, u).liste[0].gesendet === String(zeile[k.Gesendet]));
}

console.log('\n' + '='.repeat(46));
console.log(pass + ' bestanden, ' + fail + ' gescheitert');
process.exit(fail ? 1 : 0);
