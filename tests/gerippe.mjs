/**
 * Google-Tabellen-Gerippe im Speicher, damit Code.gs ohne Netz und ohne
 * Google-Konto laufen kann. Wird von tests/backend.mjs und von
 * tests/csv_beispiel.mjs benutzt.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

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
    this.gelesen = 0;
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
  // Gezaehlt, weil daran haengt, ob ein Aufruf ein Blatt zweimal liest.
  // In Apps Script ist jedes Lesen ein Gang zum Dienst, kein Speicherzugriff.
  getDataRange() {
    this.gelesen++;
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
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
    SHEET_ID:   '1TabelleTabelleTabelleTabelleTabelle',
    PWA_URL:    'https://wareneingang.example/',
    TOKEN_READ: 'geheimwort'
  };
  const ctx = {
    console,
    // Dasselbe Date wie im Test, sonst scheitert `instanceof Date` an der
    // Realm-Grenze der vm — in Apps Script gibt es nur eine Realm.
    Date,
    SpreadsheetApp: {
      // Wie das Original: eine Adresse statt einer ID gibt «Invalid argument».
      openById: id => {
        if (!/^[-\w]{25,}$/.test(String(id || ''))) {
          throw new Error('Invalid argument: id');
        }
        return ss;
      },
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
      getFileById: id => ({
        setTrashed() {}, makeCopy() {},
        // Abgelegte Dateien lassen sich zurueckholen — daran haengt, ob das
        // Foto ohne Drive-Zugriff des Benutzers auf den Schirm kommt.
        getBlob: () => {
          const datei = ctx.__dateien.filter(x => x && x.id === String(id))[0];
          if (!datei) throw new Error('File not found: ' + id);
          return { getContentType: () => datei.typ || 'image/jpeg',
                   getBytes: () => datei.bytes || [1, 2, 3] };
        },
        // Der Ordner, in dem die Tabelle liegt — daneben entsteht die Ablage.
        getParents: () => {
          let da = String(id).indexOf('ohne-ordner') < 0;
          return { hasNext: () => da, next: () => { da = false; return ordner('eltern'); } };
        }
      }),
      getFolderById: id => {
        // Eine ID, die es nicht gibt, wirft — daran haengt die Rueckmeldung
        // «Ordner nicht erreichbar» im Adminbereich.
        if (String(id).indexOf('kaputt') >= 0) throw new Error('not found');
        return ordner(id);
      }
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName: n => ({ name: n }) }) }) },
    ScriptApp: {
      getOAuthToken: () => 'tok',
      WeekDay: { SUNDAY: 'SUNDAY' },
      getProjectTriggers: () => ctx.__ausloeser.slice(),
      deleteTrigger: t => {
        const i = ctx.__ausloeser.indexOf(t);
        if (i >= 0) ctx.__ausloeser.splice(i, 1);
      },
      newTrigger: fn => {
        const bau = { fn: fn, getHandlerFunction: () => fn };
        const kette = {
          timeBased: () => kette,
          onWeekDay: tag => { bau.tag = tag; return kette; },
          atHour: h => { bau.stunde = h; return kette; },
          create: () => { ctx.__ausloeser.push(bau); return bau; }
        };
        return kette;
      }
    },
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
      // Echtes SHA-256: die Spielzeugfassung von frueher lieferte pro Runde
      // ein laengeres Ergebnis, was beim wiederholten Hashen ausufert.
      computeDigest: (_, s) =>
        Array.from(createHash('sha256').update(String(s), 'utf8').digest()),
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64Decode: s => Buffer.from(s, 'base64'),
      // Name und Typ merken: daran haengt, ob die Endung zum Bild passt.
      newBlob: (bytes, typ, name) => ({ typ: typ, name: name, bytes: bytes }),
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
    // Der Cache von Apps Script, so weit der Code ihn benutzt. Ablaufen
    // laesst er sich hier von Hand (__cache.leeren()) — der Ablauf nach
    // einer Minute ist sonst nicht pruefbar, und genau daran haengt, ob
    // eine Aenderung in der Tabelle jemals ankommt.
    CacheService: { getScriptCache: () => ctx.__cache },
    ContentService: {
      MimeType: { JSON: 'json', CSV: 'csv' },
      createTextOutput: t => ({ setMimeType: () => t, t })
    },
    __cache: (() => {
      const m = new Map();
      return {
        get: k => (m.has(k) ? m.get(k) : null),
        put: (k, v) => { m.set(k, v); },
        remove: k => { m.delete(k); },
        removeAll: ks => { (ks || []).forEach(k => m.delete(k)); },
        leeren: () => m.clear(),
        anzahl: () => m.size
      };
    })(),
    __mails: [],
    __sperren: [],
    __eigenschaften: eigenschaften,
    __dateien: [],
    __ordner: [],
    __ausloeser: []
  };
  function ordner(id) {
    return { getName: () => 'Ordner ' + String(id || 'X'),
             getId: () => 'id-' + String(id || 'X'),
             getFoldersByName: name => {
               // Beim zweiten Aufruf denselben Ordner zurueckgeben, sonst
               // liesse sich nicht pruefen, dass nichts doppelt entsteht.
               const da = ctx.__ordner.indexOf(name) >= 0;
               return { hasNext: () => da, next: () => ordner(name) };
             },
             createFolder: name => { ctx.__ordner.push(name); return ordner(name); },
             createFile: b => {
               // Eine ID von mindestens 25 Wortzeichen, wie bei Google —
               // driveId() faellt sonst auf die ganze Adresse zurueck und
               // das Wiederholen der Datei waere nie geprueft.
               const id = 'datei' + String(ctx.__dateien.length).padStart(21, '0');
               ctx.__dateien.push({ id: id, name: b && b.name,
                                    typ: b && b.typ, bytes: b && b.bytes });
               return { getUrl: () => 'https://drive.google.com/file/d/' + id + '/view' };
             } };
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

/**
 * Der erweiterte Sheets-Dienst, so wie er sich an der lebenden Tabelle
 * verhalten hat — und das ist der Punkt: eine Attrappe, die einfach
 * getValues() durchreicht, wuerde die eine Frage, um die es geht, gar
 * nicht stellen.
 *
 * `batchGet` gibt Datum und Uhrzeit als TEXT im Anzeigeformat der Spalte
 * zurueck, nicht als Date. Am 11.09.2026 an der echten Tabelle gemessen:
 *
 *   «AngDat»      Date 2026-09-10 00:00   →  "2026-09-10"
 *   «AngZeit»     Date 1899-12-30 12:40   →  "12:40"
 *   «Zeitstempel» Date 2026-09-09 17:03   →  "9/9/2026 17:03:05"
 *
 * Dazu die beiden anderen Eigenheiten: leere Endzellen fallen weg, und
 * die Bereiche kommen in der Reihenfolge zurueck, in der gefragt wurde —
 * worauf sich niemand verlassen soll.
 *
 * opt.verdrehen  Bereiche in umgekehrter Reihenfolge zurueckgeben
 * opt.kuerzen    leere Endzellen abschneiden, wie es der Dienst tut
 * opt.roh        Datumswerte NICHT zu Text machen (fuer Gegenproben)
 */
function sheetsAttrappe(ss, opt) {
  opt = opt || {};
  const zwei = n => String(n).padStart(2, '0');
  const alsText = (name, w) => {
    if (opt.roh || !(w instanceof Date)) return w;
    if (/Zeit$/.test(name)) return zwei(w.getHours()) + ':' + zwei(w.getMinutes());
    if (/Dat$/.test(name) || name === 'MHD') {
      return w.getFullYear() + '-' + zwei(w.getMonth() + 1) + '-' + zwei(w.getDate());
    }
    return (w.getMonth() + 1) + '/' + w.getDate() + '/' + w.getFullYear() + ' ' +
           zwei(w.getHours()) + ':' + zwei(w.getMinutes()) + ':' + zwei(w.getSeconds());
  };

  return { Spreadsheets: { Values: { batchGet: (id, o) => {
    const namen = o.ranges.map(r => r.replace(/^'|'$/g, '').replace(/''/g, "'"));
    const bereiche = namen.map(n => {
      // Bewusst an getDataRange() vorbei: der erweiterte Dienst geht nicht
      // ueber SpreadsheetApp, und der Lesezaehler des Blattes darf davon
      // nichts mitbekommen — sonst liesse sich nicht mehr pruefen, welcher
      // Weg wirklich benutzt wurde.
      const sh = ss.blaetter[n];
      const roh = sh.daten.map(z => {
        const voll = [];
        for (let j = 0; j < z.length; j++) voll.push(z[j] === undefined ? '' : z[j]);
        return voll;
      });
      const kopf = roh.length ? roh[0].map(x => String(x || '')) : [];
      const werte = roh.map((z, i) =>
        i === 0 ? z.slice() : z.map((w, j) => alsText(kopf[j], w)));
      if (opt.kuerzen) werte.forEach((z, i) => {
        let n2 = z.length;
        while (n2 > 0 && (z[n2 - 1] === '' || z[n2 - 1] === null)) n2--;
        werte[i] = z.slice(0, n2);
      });
      return { range: "'" + n + "'!A1:Z", values: werte };
    });
    if (opt.verdrehen) bereiche.reverse();
    return { valueRanges: bereiche };
  } } } };
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


export { Range, Sheet, Spreadsheet, neueTabelle, laden, mitBenutzer,
         sheetsAttrappe, felder, POS };
