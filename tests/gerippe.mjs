/**
 * Google-Tabellen-Gerippe im Speicher, damit Code.gs ohne Netz und ohne
 * Google-Konto laufen kann. Wird von tests/backend.mjs und von
 * tests/csv_beispiel.mjs benutzt.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

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
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    v.forEach((z, i) => z.forEach((w, j) => { this.sh._z(this.r + i)[this.c + j - 1] = w; }));
    return this;
  }
  setValue(w) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.sh._z(this.r + i)[this.c + j - 1] = w;
    return this;
  }
  // Das Zahlenformat wird gemerkt: an ihm haengt, ob Sheets aus «08:30»
  // eine Uhrzeit macht. Der Rest der Formatierung muss nur verkettbar sein.
  setNumberFormat(f) {
    this.sh.formate.push({ format: f, spalte: this.c, zeile: this.r, zeilen: this.nr });
    return this;
  }
  // Verbundene Bereiche werden gemerkt: an ihnen haengt, ob die langen
  // Beschriftungen des Papiers im Excel lesbar sind oder abgeschnitten.
  merge() {
    this.sh.verbunden.push({ zeile: this.r, spalte: this.c,
                             zeilen: this.nr, spalten: this.nc });
    return this;
  }
  setFontWeight() { return this; } setFontSize() { return this; }
  setBackground() { return this; } setBorder() { return this; }
  setWrap() { return this; } setVerticalAlignment() { return this; }
  setHorizontalAlignment() { return this; }
  setFontColor() { return this; }
}

class Sheet {
  constructor(name, kopf) {
    this.name = name;
    this.daten = [];
    this.geloescht = [];
    this.formate = [];
    this.verbunden = [];
    if (kopf) this.daten.push(kopf.slice());
  }
  _z(n) { while (this.daten.length < n) this.daten.push([]); return this.daten[n - 1]; }
  setName(n) { this.name = n; return this; }
  getLastRow() { return this.daten.length; }
  // Google legt ein Blatt mit 1000 Zeilen an; darueber waechst es mit.
  getMaxRows() { return Math.max(1000, this.daten.length); }
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
  getName() { return 'Wareneingang (Test)'; }
}

function neueTabelle() {
  const ss = new Spreadsheet();
  const B = (n, kopf) => (ss.blaetter[n] = new Sheet(n, kopf));
  B('Wareneingang', ['WeNr', 'Zeitstempel', 'Erfasser', 'Email', 'Kunde', 'Lieferant',
    'AngNam', 'AngDat', 'AngZeit', 'GezNam', 'GezDat', 'GezZeit',
    'EinNam', 'EinDat', 'EinZeit', 'LagerM2', 'Bemerkung',
    'Storniert', 'Status', 'FotoUrl', 'DateiUrl', 'Gesendet', 'Vorgang']);
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
  // Der Code wird unveraendert geladen — die Installation steckt in den
  // Skripteigenschaften, nicht mehr in drei Konstanten, die der Test
  // vorher im Quelltext ersetzen musste.
  const quelle = fs.readFileSync(process.cwd() + '/apps-script/Code.gs', 'utf8');
  const eigenschaften = {
    SHEET_ID:   'X',
    PWA_URL:    'https://wareneingang.example/',
    TOKEN_READ: 'geheimwort'
  };
  const ctx = {
    console,
    // Dasselbe Date wie im Test, sonst scheitert `instanceof Date` an der
    // Realm-Grenze der vm — in Apps Script gibt es nur eine Realm.
    Date,
    SpreadsheetApp: {
      openById: () => ss,
      create: () => { const t = new Spreadsheet(); t.blaetter.T = new Sheet('T'); return t; },
      flush: () => {},
      BorderStyle: { SOLID: 'SOLID' }
    },
    // Die Sperre wird mitgeschrieben: an ihr haengt, ob zwei gleichzeitige
    // Klicks an derselben Pruefung vorbeikommen.
    LockService: {
      getScriptLock: () => ({
        waitLock() { ctx.__sperren.push('an'); },
        releaseLock() { ctx.__sperren.push('aus'); }
      })
    },
    DriveApp: {
      getFileById: () => ({ setTrashed() {}, makeCopy() {} }),
      getFolderById: id => {
        // Eine ID, die es nicht gibt, wirft — daran haengt die Rueckmeldung
        // «Ordner nicht erreichbar» im Adminbereich.
        if (String(id).indexOf('kaputt') >= 0) throw new Error('not found');
        return ordner(id);
      }
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName: n => ({ name: n }) }) }) },
    ScriptApp: { getOAuthToken: () => 'tok' },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.assign({}, eigenschaften),
        setProperty: (k, v) => { eigenschaften[k] = v; },
        deleteProperty: k => { delete eigenschaften[k]; }
      })
    },
    MailApp: { sendEmail: (...a) => ctx.__mails.push(a) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'S' },
      computeDigest: (_, s) => Array.from(s).map(c => c.charCodeAt(0)),
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64Decode: s => Buffer.from(s, 'base64'),
      newBlob: () => ({}),
      getUuid: () => randomUUID(),
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
    __mails: [],
    __sperren: [],
    __eigenschaften: eigenschaften
  };
  function ordner(id) {
    return { getName: () => 'Ordner ' + String(id || 'X'),
             getFoldersByName: () => ({ hasNext: () => false }),
             createFolder: () => ordner(id), createFile: () => ({ getUrl: () => 'https://drive/x' }) };
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

/** Zerlegt eine CSV-Zeile; naives split(',') bricht bei gequoteten Feldern. */
function felder(zeile) {
  const aus = [];
  let feld = '', inAnf = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (inAnf) {
      if (c === '"' && zeile[i + 1] === '"') { feld += '"'; i++; }
      else if (c === '"') inAnf = false;
      else feld += c;
    } else if (c === '"') inAnf = true;
    else if (c === ',') { aus.push(feld); feld = ''; }
    else feld += c;
  }
  aus.push(feld);
  return aus;
}

const POS = [
  { artikel: 'Schrauben M6', anzahl: 120, kg: 3.4, mhd: '10.2027', bemerkung: '', bestehend: true },
  { artikel: '', anzahl: '', kg: '', mhd: '', bemerkung: '', bestehend: false },
  { artikel: 'Kartonage', anzahl: 8, kg: '', mhd: '', bemerkung: 'Ecke gedrückt', bestehend: false }
];


export { Range, Sheet, Spreadsheet, neueTabelle, laden, mitBenutzer, felder, POS };
