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

console.log('\n9) Excel-Blatt');
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
  ok('Quittungskopf in Zeile 3', zelle(3, 1) === 'Aufgabe / Task');
  ok('Angenommen mit Namen', zelle(4, 2) === 'Anna Muster');
  ok('Gezaehlt mit Namen', zelle(5, 2) === 'Anna Muster');
  ok('Eingelagert leer', zelle(6, 2) === '');
  ok('Kunde in A10/B10', zelle(10, 1) === 'Kunde / Client' && zelle(10, 2) === 'Kunde AG');
  ok('Lieferant in Zeile 11', zelle(11, 2) === 'Lief GmbH');
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

console.log('\n' + '='.repeat(46));
console.log(pass + ' bestanden, ' + fail + ' gescheitert');
process.exit(fail ? 1 : 0);
