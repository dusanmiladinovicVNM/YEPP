/**
 * Prueft Code.gs gegen ein Google-Tabellen-Gerippe im Speicher.
 * Ziel sind die Stellen, an denen Spalten- und Zeilenindizes verrutschen.
 */
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else   { fail++; console.log('  FAIL  ' + n + (extra ? '\n        ' + extra : '')); }
};

/* ---------- Tabellen-Gerippe ---------- */

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const aus = [];
    for (let i = 0; i < this.nr; i++) {
      const z = [];
      for (let j = 0; j < this.nc; j++) z.push(this.sh._z(this.r + i)[this.c + j - 1] ?? '');
      aus.push(z);
    }
    return aus;
  }
  setValues(v) {
    v.forEach((z, i) => z.forEach((w, j) => { this.sh._z(this.r + i)[this.c + j - 1] = w; }));
    return this;
  }
  setValue(w) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.sh._z(this.r + i)[this.c + j - 1] = w;
    return this;
  }
  // Formatierung interessiert hier nicht, muss aber verkettbar bleiben
  setFontWeight() { return this; } setFontSize() { return this; }
  setBackground() { return this; } setBorder() { return this; }
  setWrap() { return this; } setVerticalAlignment() { return this; }
  setHorizontalAlignment() { return this; } setNumberFormat() { return this; }
  setFontColor() { return this; }
}

class Sheet {
  constructor(name, kopf) {
    this.name = name;
    this.daten = [];
    this.geloescht = [];
    if (kopf) this.daten.push(kopf.slice());
  }
  _z(n) { while (this.daten.length < n) this.daten.push([]); return this.daten[n - 1]; }
  setName(n) { this.name = n; return this; }
  getLastRow() { return this.daten.length; }
  getLastColumn() { return Math.max(0, ...this.daten.map(z => z.length)); }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') {
      const m = r.match(/^([A-Z]+)(\d+)$/);
      const sp = m[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
      return new Range(this, Number(m[2]), sp, 1, 1);
    }
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(z) { this.daten.push(z.slice()); }
  deleteRow(n) { this.geloescht.push(n); this.daten.splice(n - 1, 1); }
  setColumnWidth() { return this; } setColumnWidths() { return this; }
  setRowHeight() { return this; }  setRowHeights() { return this; }
  setFrozenRows() { return this; }
}

class Spreadsheet {
  constructor() { this.blaetter = {}; }
  getSheetByName(n) { return this.blaetter[n] || null; }
  insertSheet(n) { return (this.blaetter[n] = new Sheet(n)); }
  getSheets() { return Object.values(this.blaetter); }
  getId() { return 'TMPID'; }
}

function neueTabelle() {
  const ss = new Spreadsheet();
  const B = (n, kopf) => (ss.blaetter[n] = new Sheet(n, kopf));
  B('Wareneingang', ['WeNr', 'Zeitstempel', 'Erfasser', 'Email', 'Kunde', 'Lieferant',
    'AngNam', 'AngDat', 'AngZeit', 'GezNam', 'GezDat', 'GezZeit',
    'EinNam', 'EinDat', 'EinZeit', 'LagerM2', 'Bemerkung',
    'Storniert', 'Status', 'FotoUrl', 'DateiUrl', 'Gesendet']);
  B('Positionen', ['WeNr', 'Nr', 'Artikel', 'Anzahl', 'KG', 'MHD',
    'Regalplatz', 'Bemerkung', 'Bestehend']);
  B('Kunden', ['Name', 'Aktiv', 'Sortierung']);
  B('Lieferanten', ['Name', 'Aktiv', 'Sortierung']);
  B('Benutzer', ['Email', 'Name', 'PassHash', 'Salt', 'Aktiv', 'Fehler',
    'GesperrtBis', 'LetzterLogin', 'PwGeaendert', 'Rolle']);
  B('Sessions', ['Token', 'Email', 'GueltigBis']);
  B('Parameter', ['Schluessel', 'Wert', 'GueltigAb']);
  return ss;
}

/* ---------- Code.gs laden ---------- */

function laden(ss) {
  const quelle = fs.readFileSync(process.cwd() + '/apps-script/Code.gs', 'utf8')
    .replace("const SHEET_ID   = '';", "const SHEET_ID   = 'X';");
  const ctx = {
    console,
    SpreadsheetApp: {
      openById: () => ss,
      create: () => { const t = new Spreadsheet(); t.blaetter.T = new Sheet('T'); return t; },
      flush: () => {},
      BorderStyle: { SOLID: 'SOLID' }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: {
      getFileById: () => ({ setTrashed() {}, makeCopy() {} }),
      getFolderById: () => ordner()
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName: n => ({ name: n }) }) }) },
    ScriptApp: { getOAuthToken: () => 'tok' },
    MailApp: { sendEmail: (...a) => ctx.__mails.push(a) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'S' },
      computeDigest: (_, s) => Array.from(s).map(c => c.charCodeAt(0)),
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64Decode: s => Buffer.from(s, 'base64'),
      newBlob: () => ({}),
      formatDate: (d, _z, m) => {
        const p = x => String(x).padStart(2, '0');
        return m
          .replace('yyyy', d.getFullYear())
          .replace('MM', p(d.getMonth() + 1))
          .replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours()))
          .replace('mm', p(d.getMinutes()));
      }
    },
    ContentService: {
      MimeType: { JSON: 'json', CSV: 'csv' },
      createTextOutput: t => ({ setMimeType: () => t, t })
    },
    __mails: []
  };
  function ordner() {
    return { getFoldersByName: () => ({ hasNext: () => false }),
             createFolder: () => ordner(), createFile: () => ({ getUrl: () => 'https://drive/x' }) };
  }
  vm.createContext(ctx);
  vm.runInContext(quelle, ctx);
  return ctx;
}

/* ---------- Vorbereitung ---------- */

function mitBenutzer(ctx, ss) {
  ss.blaetter.Benutzer.appendRow(
    ['anna@firma.ch', 'Anna Muster', '', '', true, 0, '', '', true, 'admin']);
  ss.blaetter.Benutzer.appendRow(
    ['bob@firma.ch', 'Bob Meier', '', '', true, 0, '', '', true, '']);
  ss.blaetter.Sessions.appendRow(['tokA', 'anna@firma.ch', new Date(Date.now() + 8.64e7)]);
  ss.blaetter.Sessions.appendRow(['tokB', 'bob@firma.ch', new Date(Date.now() + 8.64e7)]);
  return ctx.sitzungPruefen('tokA');
}

const POS = [
  { artikel: 'Schrauben M6', anzahl: 120, kg: 3.4, mhd: '10.2027', bemerkung: '', bestehend: true },
  { artikel: '', anzahl: '', kg: '', mhd: '', bemerkung: '', bestehend: false },
  { artikel: 'Kartonage', anzahl: 8, kg: '', mhd: '', bemerkung: 'Ecke gedrückt', bestehend: false }
];

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

console.log('\n6) CSV');
{
  const ss = neueTabelle(), ctx = laden(ss);
  const u = mitBenutzer(ctx, ss);
  ctx.weSpeichern({ kunde: 'Meier, Sohn & Co', lieferant: 'L',
    positionen: [{ artikel: 'Rohr "40mm"', anzahl: 2, kg: '', mhd: '',
                   bemerkung: '', bestehend: true }] }, u);
  const nr2 = ctx.weSpeichern({ kunde: 'Weg', positionen: POS }, u).weNr;
  ctx.weStorno({ weNr: nr2 }, u);

  const csv = ctx.csvExport();
  const zeilen = csv.split('\n');
  ok('Kopfzeile', zeilen[0].startsWith('WeNr,Datum,Zeit,Kunde,Lieferant,Nr,Artikel'));
  ok('nur die nicht stornierte Erfassung', zeilen.length === 2, zeilen.length + ' Zeilen');
  ok('Komma im Feld wird gequotet', csv.includes('"Meier, Sohn & Co"'));
  ok('Anfuehrungszeichen verdoppelt', csv.includes('"Rohr ""40mm"""'), zeilen[1]);
  ok('Bestehend als X', zeilen[1].includes(',X,'));
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
