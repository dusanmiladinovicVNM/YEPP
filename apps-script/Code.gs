/**
 * Wareneingang / Material reception — Backend
 *
 * Ein einziges Skript: Anmeldung, Erfassung, Arbeitsschritte, Excel-Versand.
 * Die Tabelle ist nie oeffentlich. Jeder Zugriff laeuft ueber dieses Skript,
 * das die Sitzung prueft. Die Identitaet stammt aus der Sitzung, nie aus dem
 * Request — niemand kann unter fremdem Namen quittieren.
 *
 * Nach jeder Aenderung: Bereitstellen -> Bereitstellungen verwalten ->
 * Bearbeiten -> Neue Version. Ohne das liefert die URL weiterhin alten Code.
 */

/* ============================================================
   1) Konfiguration — hier eintragen
   ============================================================ */

const SHEET_ID   = '';   // ID der Tabelle, aus der URL zwischen /d/ und /edit
const PWA_URL    = '';   // Adresse der PWA, kommt in die Zugangsmails
const TOKEN_READ = '';   // frei gewaehltes Wort, schuetzt den CSV-Export

/* Blattnamen — nur aendern, wenn die Tabelle anders heisst. */
const T = {
  we:          'Wareneingang',
  pos:         'Positionen',
  kunden:      'Kunden',
  lieferanten: 'Lieferanten',
  benutzer:    'Benutzer',
  sessions:    'Sessions',
  parameter:   'Parameter'
};

const ZEITZONE       = 'Europe/Zurich';
const SITZUNG_TAGE   = 30;   // Gueltigkeit einer Anmeldung
const MAX_FEHLER     = 5;    // danach Sperre
const SPERRE_MINUTEN = 15;
const MIN_ZEILEN     = 5;    // Positionszeilen im Formular, wie auf dem Papier

/* ============================================================
   2) Einstiegspunkte
   ============================================================ */

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    return json(verteilen(d));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};

  // CSV-Export fuer Excel / Power Query — nur mit Token, ohne Sitzung
  if (p.format === 'csv') {
    if (!TOKEN_READ || p.token !== TOKEN_READ) {
      return ContentService.createTextOutput('kein Zugriff');
    }
    return ContentService.createTextOutput(csvExport())
      .setMimeType(ContentService.MimeType.CSV);
  }

  try {
    return json(verteilen(p));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Eine Stelle, an der entschieden wird, was eine Aktion darf. */
function verteilen(d) {
  const aktion = d.action || 'we_speichern';

  // ohne Sitzung erreichbar
  if (aktion === 'login') return login(d);

  const u = sitzungPruefen(d.session);
  if (!u) return { ok: false, error: 'session' };

  // Solange das zugestellte Passwort nicht ersetzt ist, geht nur der Wechsel.
  if (!u.pwGeaendert && aktion !== 'passwort') {
    return { ok: false, error: 'passwort_noetig' };
  }

  switch (aktion) {
    case 'passwort':      return passwortSetzen(d, u);
    case 'stammdaten':    return stammdaten();
    case 'we_speichern':  return weSpeichern(d, u);
    case 'we_schritt':    return weSchritt(d, u);
    case 'we_liste':      return weListe(d, u);
    case 'we_detail':     return weDetail(d, u);
    case 'we_storno':     return weStorno(d, u);
    case 'we_senden':     return weSenden(d, u);
  }

  // Adminrechte werden hier geprueft, nicht in der App. Das versteckte
  // Knopf in der Oberflaeche ist keine Sicherung — der Client kann alles senden.
  if (aktion.indexOf('admin_') === 0) {
    if (u.rolle !== 'admin') return { ok: false, error: 'keine Berechtigung' };
    switch (aktion) {
      case 'admin_liste':  return adminListe();
      case 'admin_neu':    return adminNeu(d, u);
      case 'admin_aktion': return adminAktion(d, u);
    }
  }

  return { ok: false, error: 'unbekannte Aktion' };
}

/* ============================================================
   3) Anmeldung und Sitzung
   ============================================================ */

function login(d) {
  const email = String(d.email || '').trim().toLowerCase();
  const pass  = String(d.passwort || '');
  if (!email || !pass) return { ok: false, error: 'login' };

  const bl  = blatt(T.benutzer);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);

  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Email]).trim().toLowerCase() !== email) continue;

    const zeile = i + 1;
    if (String(dat[i][k.Aktiv]).toLowerCase() === 'false') {
      return { ok: false, error: 'inaktiv' };
    }

    const bis = dat[i][k.GesperrtBis];
    if (bis && new Date(bis) > new Date()) return { ok: false, error: 'gesperrt' };

    const salt = String(dat[i][k.Salt] || '');
    const soll = String(dat[i][k.PassHash] || '');
    if (!salt || !soll || hash(pass, salt) !== soll) {
      const fehler = Number(dat[i][k.Fehler] || 0) + 1;
      bl.getRange(zeile, k.Fehler + 1).setValue(fehler);
      if (fehler >= MAX_FEHLER) {
        bl.getRange(zeile, k.GesperrtBis + 1)
          .setValue(new Date(Date.now() + SPERRE_MINUTEN * 60000));
      }
      return { ok: false, error: 'login' };
    }

    bl.getRange(zeile, k.Fehler + 1).setValue(0);
    bl.getRange(zeile, k.GesperrtBis + 1).setValue('');
    bl.getRange(zeile, k.LetzterLogin + 1).setValue(new Date());

    const pwGeaendert = String(dat[i][k.PwGeaendert]).toLowerCase() === 'true';
    return {
      ok: true,
      session: sitzungAnlegen(email),
      name: String(dat[i][k.Name] || ''),
      rolle: String(dat[i][k.Rolle] || ''),
      pwGeaendert: pwGeaendert
    };
  }
  return { ok: false, error: 'login' };
}

function sitzungAnlegen(email) {
  const token = zufall(32);
  blatt(T.sessions).appendRow([
    token, email, new Date(Date.now() + SITZUNG_TAGE * 86400000)
  ]);
  return token;
}

/** Gibt den Benutzer zurueck oder null. Einzige Quelle fuer die Identitaet. */
function sitzungPruefen(token) {
  if (!token) return null;

  const sd = blatt(T.sessions).getDataRange().getValues();
  let email = '';
  for (let i = 1; i < sd.length; i++) {
    if (String(sd[i][0]) !== String(token)) continue;
    if (sd[i][2] && new Date(sd[i][2]) < new Date()) return null;
    email = String(sd[i][1]).trim().toLowerCase();
    break;
  }
  if (!email) return null;

  const bd = blatt(T.benutzer).getDataRange().getValues();
  const k  = spalten(bd[0]);
  for (let i = 1; i < bd.length; i++) {
    if (String(bd[i][k.Email]).trim().toLowerCase() !== email) continue;
    // Deaktivierung wirkt sofort, auch auf laufende Sitzungen.
    if (String(bd[i][k.Aktiv]).toLowerCase() === 'false') return null;
    return {
      email: email,
      name: String(bd[i][k.Name] || ''),
      rolle: String(bd[i][k.Rolle] || ''),
      pwGeaendert: String(bd[i][k.PwGeaendert]).toLowerCase() === 'true',
      zeile: i + 1
    };
  }
  return null;
}

function passwortSetzen(d, u) {
  const alt = String(d.alt || '');
  const neu = String(d.neu || '');
  if (neu.length < 8) return { ok: false, error: 'zu_kurz' };

  const bl  = blatt(T.benutzer);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = u.zeile - 1;

  if (hash(alt, String(dat[i][k.Salt] || '')) !== String(dat[i][k.PassHash] || '')) {
    return { ok: false, error: 'alt_falsch' };
  }

  const salt = zufall(16);
  bl.getRange(u.zeile, k.Salt + 1).setValue(salt);
  bl.getRange(u.zeile, k.PassHash + 1).setValue(hash(neu, salt));
  bl.getRange(u.zeile, k.PwGeaendert + 1).setValue(true);

  // Ein Passwortwechsel meldet alle Geraete ab — auch ein verlorenes.
  sitzungenLoeschen(u.email);
  return { ok: true, session: sitzungAnlegen(u.email) };
}

function sitzungenLoeschen(email) {
  const bl  = blatt(T.sessions);
  const dat = bl.getDataRange().getValues();
  for (let i = dat.length - 1; i >= 1; i--) {
    if (String(dat[i][1]).trim().toLowerCase() === String(email).toLowerCase()) {
      bl.deleteRow(i + 1);
    }
  }
}

/* ============================================================
   4) Stammdaten
   ============================================================ */

function stammdaten() {
  return {
    ok: true,
    kunden: listeAktiv(T.kunden),
    lieferanten: listeAktiv(T.lieferanten)
  };
}

function listeAktiv(name) {
  const dat = blatt(name).getDataRange().getValues();
  const k   = spalten(dat[0]);
  const aus = [];
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Aktiv]).toLowerCase() === 'false') continue;
    const wert = String(dat[i][k.Name] || '').trim();
    if (wert) aus.push({ name: wert, sort: Number(dat[i][k.Sortierung] || 0) });
  }
  aus.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
  return aus.map(x => x.name);
}

/* ============================================================
   5) Wareneingang erfassen
   ============================================================ */

/**
 * Legt einen Wareneingang an. «Angenommen» wird dabei sofort mit dem Namen
 * aus der Sitzung quittiert — wer erfasst, hat die Ware angenommen.
 */
function weSpeichern(d, u) {
  const kunde     = String(d.kunde || '').trim();
  const lieferant = String(d.lieferant || '').trim();
  const pos       = Array.isArray(d.positionen) ? d.positionen : [];

  if (!kunde && !lieferant) return { ok: false, error: 'kunde_lieferant' };
  if (!pos.length)          return { ok: false, error: 'keine_positionen' };

  const sperre = LockService.getScriptLock();
  sperre.waitLock(20000);
  try {
    const weNr = naechsteNummer();
    const jetzt = new Date();
    const datum = fmt(jetzt, 'yyyy-MM-dd');
    const zeit  = fmt(jetzt, 'HH:mm');

    const bl = blatt(T.we);
    const k  = spalten(bl.getDataRange().getValues()[0]);
    const z  = new Array(bl.getLastColumn()).fill('');

    z[k.WeNr]        = weNr;
    z[k.Zeitstempel] = jetzt;
    z[k.Erfasser]    = u.name;
    z[k.Email]       = u.email;
    z[k.Kunde]       = kunde;
    z[k.Lieferant]   = lieferant;
    z[k.AngNam]      = u.name;
    z[k.AngDat]      = datum;
    z[k.AngZeit]     = zeit;
    z[k.LagerM2]     = d.lagerM2 === '' || d.lagerM2 == null ? '' : Number(d.lagerM2);
    z[k.Bemerkung]   = String(d.bemerkung || '').trim();
    z[k.Storniert]   = false;
    z[k.Status]      = 'angenommen';
    z[k.FotoUrl]     = d.foto ? fotoAblegen(d.foto, weNr, u) : '';
    bl.appendRow(z);

    positionenSchreiben(weNr, pos);
    return { ok: true, weNr: weNr };
  } finally {
    sperre.releaseLock();
  }
}

function positionenSchreiben(weNr, pos) {
  const bl = blatt(T.pos);
  const k  = spalten(bl.getDataRange().getValues()[0]);
  const breite = bl.getLastColumn();
  const zeilen = [];
  let nr = 0;

  pos.forEach(p => {
    const artikel = String(p.artikel || '').trim();
    if (!artikel) return;                       // leere Formularzeilen weglassen
    // Fortlaufend zaehlen, nicht nach Eingabeindex: sonst reisst die
    // Nummerierung an einer leeren Zeile ein Loch, und die Regalplaetze
    // aus dem Einlagern landen an der falschen Position.
    nr++;
    const z = new Array(breite).fill('');
    z[k.WeNr]       = weNr;
    z[k.Nr]         = nr;
    z[k.Artikel]    = artikel;
    z[k.Anzahl]     = p.anzahl === '' || p.anzahl == null ? '' : Number(p.anzahl);
    z[k.KG]         = p.kg === '' || p.kg == null ? '' : Number(p.kg);
    z[k.MHD]        = String(p.mhd || '').trim();
    z[k.Regalplatz] = String(p.regalplatz || '').trim();
    z[k.Bemerkung]  = String(p.bemerkung || '').trim();
    z[k.Bestehend]  = p.bestehend === true;
    zeilen.push(z);
  });

  if (zeilen.length) {
    bl.getRange(bl.getLastRow() + 1, 1, zeilen.length, breite).setValues(zeilen);
  }
}

/** Fortlaufend, pro Jahr: WE-2026-0001 */
function naechsteNummer() {
  const jahr = fmt(new Date(), 'yyyy');
  const dat  = blatt(T.we).getDataRange().getValues();
  const k    = spalten(dat[0]);
  let max = 0;
  for (let i = 1; i < dat.length; i++) {
    const m = String(dat[i][k.WeNr] || '').match(/^WE-(\d{4})-(\d+)$/);
    if (m && m[1] === jahr) max = Math.max(max, Number(m[2]));
  }
  return 'WE-' + jahr + '-' + String(max + 1).padStart(4, '0');
}

/* ============================================================
   6) Arbeitsschritte quittieren
   ============================================================ */

const SCHRITTE = {
  gezaehlt:    { nam: 'GezNam', dat: 'GezDat', zeit: 'GezZeit' },
  eingelagert: { nam: 'EinNam', dat: 'EinDat', zeit: 'EinZeit' }
};

/**
 * Quittiert «Gezaehlt & kontrolliert» oder «Eingelagert».
 * Der Name kommt aus der Sitzung, Datum und Zeit vom Server —
 * eine Quittung unter fremdem Namen ist so nicht moeglich.
 */
function weSchritt(d, u) {
  const feld = SCHRITTE[String(d.schritt || '')];
  if (!feld) return { ok: false, error: 'unbekannter Schritt' };

  const bl  = blatt(T.we);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };
  if (String(dat[i][k.Storniert]).toLowerCase() === 'true') {
    return { ok: false, error: 'storniert' };
  }
  if (String(dat[i][k[feld.nam]] || '').trim()) {
    return { ok: false, error: 'bereits_quittiert' };
  }

  const jetzt = new Date();
  bl.getRange(i + 1, k[feld.nam] + 1).setValue(u.name);
  bl.getRange(i + 1, k[feld.dat] + 1).setValue(fmt(jetzt, 'yyyy-MM-dd'));
  bl.getRange(i + 1, k[feld.zeit] + 1).setValue(fmt(jetzt, 'HH:mm'));
  bl.getRange(i + 1, k.Status + 1).setValue(d.schritt);

  // Regalplaetze traegt das zweite Team beim Einlagern nach.
  if (d.schritt === 'eingelagert' && Array.isArray(d.regalplaetze)) {
    regalplaetzeSchreiben(d.weNr, d.regalplaetze);
  }
  return { ok: true, name: u.name, datum: fmt(jetzt, 'yyyy-MM-dd'), zeit: fmt(jetzt, 'HH:mm') };
}

function regalplaetzeSchreiben(weNr, werte) {
  const bl  = blatt(T.pos);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.WeNr]) !== String(weNr)) continue;
    const nr = Number(dat[i][k.Nr]);
    const w  = werte[nr - 1];
    if (w != null && String(w).trim()) {
      bl.getRange(i + 1, k.Regalplatz + 1).setValue(String(w).trim());
    }
  }
}

/* ============================================================
   7) Ansehen und zuruecknehmen
   ============================================================ */

function weListe(d, u) {
  const dat = blatt(T.we).getDataRange().getValues();
  const k   = spalten(dat[0]);
  const aus = [];

  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Storniert]).toLowerCase() === 'true') continue;
    if (!d.alle && String(dat[i][k.Email]).toLowerCase() !== u.email) {
      // Offene Schritte sieht das ganze Team — sonst koennte niemand
      // quittieren, was ein Kollege angenommen hat.
      if (String(dat[i][k.Status]) === 'eingelagert') continue;
    }
    aus.push({
      weNr:      String(dat[i][k.WeNr]),
      datum:     String(dat[i][k.AngDat] || ''),
      zeit:      String(dat[i][k.AngZeit] || ''),
      kunde:     String(dat[i][k.Kunde] || ''),
      lieferant: String(dat[i][k.Lieferant] || ''),
      status:    String(dat[i][k.Status] || ''),
      erfasser:  String(dat[i][k.Erfasser] || ''),
      gesendet:  String(dat[i][k.Gesendet] || '')
    });
  }
  aus.reverse();
  return { ok: true, liste: aus.slice(0, 100) };
}

function weDetail(d, u) {
  const dat = blatt(T.we).getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };

  const kopf = {};
  Object.keys(k).forEach(name => {
    const w = dat[i][k[name]];
    kopf[name] = w instanceof Date ? fmt(w, 'yyyy-MM-dd HH:mm') : String(w == null ? '' : w);
  });

  return { ok: true, kopf: kopf, positionen: positionenLesen(d.weNr) };
}

function positionenLesen(weNr) {
  const dat = blatt(T.pos).getDataRange().getValues();
  const k   = spalten(dat[0]);
  const aus = [];
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.WeNr]) !== String(weNr)) continue;
    aus.push({
      nr:         Number(dat[i][k.Nr] || 0),
      artikel:    String(dat[i][k.Artikel] || ''),
      anzahl:     dat[i][k.Anzahl] === '' ? '' : Number(dat[i][k.Anzahl]),
      kg:         dat[i][k.KG] === '' ? '' : Number(dat[i][k.KG]),
      mhd:        String(dat[i][k.MHD] || ''),
      regalplatz: String(dat[i][k.Regalplatz] || ''),
      bemerkung:  String(dat[i][k.Bemerkung] || ''),
      bestehend:  String(dat[i][k.Bestehend]).toLowerCase() === 'true'
    });
  }
  aus.sort((a, b) => a.nr - b.nr);
  return aus;
}

/** Zuruecknehmen statt loeschen — die Zeile bleibt, nur markiert. */
function weStorno(d, u) {
  const bl  = blatt(T.we);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };

  // Fremde Erfassungen darf nur ein Admin zuruecknehmen.
  if (String(dat[i][k.Email]).toLowerCase() !== u.email && u.rolle !== 'admin') {
    return { ok: false, error: 'keine Berechtigung' };
  }
  bl.getRange(i + 1, k.Storniert + 1).setValue(true);
  return { ok: true };
}

/* ============================================================
   8) Excel erzeugen und verschicken
   ============================================================ */

/**
 * Baut das ausgefuellte Formular als .xlsx, legt es im Drive-Ordner ab und
 * schickt es an die Adresse aus «Parameter -> MailAn».
 * Kein SharePoint, keine Microsoft-Lizenz noetig.
 */
function weSenden(d, u) {
  const det = weDetail(d, u);
  if (!det.ok) return det;

  const empfaenger = String(d.mailAn || parameter('MailAn') || '').trim();
  if (!empfaenger) return { ok: false, error: 'kein_empfaenger' };

  const name = det.kopf.WeNr + '_' +
               (det.kopf.Lieferant || det.kopf.Kunde || 'Wareneingang')
                 .replace(/[^\wÄÖÜäöüß -]/g, '').trim().replace(/\s+/g, '-');

  const blob = xlsxErzeugen(det.kopf, det.positionen, name);

  MailApp.sendEmail({
    to: empfaenger,
    subject: 'Wareneingang ' + det.kopf.WeNr +
             (det.kopf.Lieferant ? ' — ' + det.kopf.Lieferant : ''),
    body: [
      'Wareneingang ' + det.kopf.WeNr,
      '',
      'Kunde:      ' + det.kopf.Kunde,
      'Lieferant:  ' + det.kopf.Lieferant,
      'Angenommen: ' + det.kopf.AngNam + ', ' + det.kopf.AngDat + ' ' + det.kopf.AngZeit,
      'Positionen: ' + det.positionen.length,
      '',
      'Das ausgefuellte Formular liegt bei.'
    ].join('\n'),
    attachments: [blob]
  });

  const ordner = ordnerFuerMonat();
  const url = ordner ? ordner.createFile(blob).getUrl() : '';

  const bl  = blatt(T.we);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  bl.getRange(i + 1, k.Gesendet + 1).setValue(fmt(new Date(), 'yyyy-MM-dd HH:mm'));
  if (url) bl.getRange(i + 1, k.DateiUrl + 1).setValue(url);

  return { ok: true, an: empfaenger, url: url };
}

/**
 * Erzeugt das Blatt in einer Wegwerf-Tabelle und exportiert es als xlsx.
 * Das Layout steht hier im Code — eine Vorlagendatei, die auseinanderlaufen
 * kann, gibt es bewusst nicht.
 */
function xlsxErzeugen(kopf, pos, name) {
  const tmp = SpreadsheetApp.create('~wareneingang-temp');
  try {
    blattAufbauen(tmp.getSheets()[0], kopf, pos);
    SpreadsheetApp.flush();

    const url = 'https://docs.google.com/spreadsheets/d/' + tmp.getId() +
                '/export?format=xlsx';
    return UrlFetchApp
      .fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } })
      .getBlob().setName(name + '.xlsx');
  } finally {
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
  }
}

/** Bildet das Papierformular nach: Spalten A..H. */
function blattAufbauen(sh, kopf, pos) {
  const RAND   = SpreadsheetApp.BorderStyle.SOLID;
  const GRAU   = '#F2F2F2';
  const GELB   = '#FFFF00';
  const anzahl = Math.max(pos.length, MIN_ZEILEN);

  sh.setName('Wareneingang');
  sh.setColumnWidths(1, 8, 110);
  sh.setColumnWidth(1, 60);    // N
  sh.setColumnWidth(2, 260);   // Artikelbezeichnung
  sh.setColumnWidth(6, 150);   // Regalplatz
  sh.setColumnWidth(7, 150);   // Bemerkungen
  sh.setColumnWidth(8, 90);    // Bestehend

  // --- Titel ---
  sh.getRange('A1').setValue('Wareneingang / Material reception')
    .setFontWeight('bold').setFontSize(12);

  // --- Quittungen ---
  const kt = [
    ['Aufgabe / Task', 'Name Mitarbeiter / Employee name', 'Datum / Date', 'Uhrzeit / Time'],
    ['Angenommen /\nAccepted',                       kopf.AngNam, kopf.AngDat, kopf.AngZeit],
    ['Gezählt & kontrolliert /\ncounted & controlled', kopf.GezNam, kopf.GezDat, kopf.GezZeit],
    ['Eingelagert / stored',                          kopf.EinNam, kopf.EinDat, kopf.EinZeit]
  ];
  sh.getRange(3, 1, 4, 4).setValues(kt)
    .setBorder(true, true, true, true, true, true, '#000000', RAND)
    .setVerticalAlignment('middle').setWrap(true);
  sh.getRange(3, 1, 1, 4).setFontWeight('bold').setBackground(GRAU);
  sh.getRange(4, 1, 3, 1).setFontSize(9);

  sh.getRange('A8').setValue(
    'Artikelanzahl bitte direkt auf dem Lieferschein abhaken bzw. anpassen.\n' +
    'Please check off or adapt the article quantities directly on the delivery slip'
  ).setFontWeight('bold').setWrap(true);
  sh.setRowHeight(8, 32);

  // --- Kunde / Lieferant ---
  sh.getRange(10, 1, 2, 2).setValues([
    ['Kunde / Client',      kopf.Kunde],
    ['Lieferant / Supplier', kopf.Lieferant]
  ]).setBorder(true, true, true, true, true, true, '#000000', RAND);
  sh.getRange(10, 1, 2, 1).setFontWeight('bold');

  sh.getRange('A13').setValue(
    'Bei neuem und bestehendem Material mit oder ohne Lieferschein notwendig:\n' +
    'For new and existing material with or without delivery slip needed'
  ).setFontWeight('bold').setWrap(true);
  sh.setRowHeight(13, 32);

  // --- Positionen ---
  const kopfZeile = 15;
  sh.getRange(kopfZeile, 1, 1, 8).setValues([[
    'N°',
    'Artikelbezeichnung / Article description',
    'Anzahl / QTY',
    'kg',
    'MHD / Expiration Date',
    'Regalplatznr., eralten durch Secend Team/shelf no. received by Secend Team',
    'Bemerkungen /Kontrolle\nComments / Checks',
    'Bestehend / Existing'
  ]]).setFontWeight('bold').setWrap(true).setVerticalAlignment('bottom')
    .setBackground(GRAU);
  sh.setRowHeight(kopfZeile, 60);

  const zeilen = [];
  for (let i = 0; i < anzahl; i++) {
    const p = pos[i];
    zeilen.push(p
      ? [p.nr, p.artikel, p.anzahl, p.kg, p.mhd, p.regalplatz, p.bemerkung,
         p.bestehend ? 'X' : '']
      : ['', '', '', '', '', '', '', '']);
  }
  const bereich = sh.getRange(kopfZeile + 1, 1, anzahl, 8);
  bereich.setValues(zeilen).setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeights(kopfZeile + 1, anzahl, 46);

  sh.getRange(kopfZeile, 1, anzahl + 1, 8)
    .setBorder(true, true, true, true, true, true, '#000000', RAND);
  sh.getRange(kopfZeile, 1, anzahl + 1, 1).setBackground(GRAU);
  sh.getRange(kopfZeile, 8, anzahl + 1, 1).setBackground(GELB)
    .setHorizontalAlignment('center');
  sh.getRange(kopfZeile + 1, 3, anzahl, 2).setHorizontalAlignment('right');

  // --- Fuss ---
  const fuss = kopfZeile + anzahl + 2;
  sh.getRange(fuss, 1).setValue('Lagerfläche / storage space').setFontWeight('bold');
  sh.getRange(fuss, 4).setValue('Umrechung/Conversion').setFontWeight('bold');
  sh.getRange(fuss + 1, 1).setValue('m2 Anzahl / m2 quantity').setFontWeight('bold');
  sh.getRange(fuss + 1, 3).setValue(kopf.LagerM2 === '' ? '' : Number(kopf.LagerM2));
  sh.getRange(fuss + 1, 4).setValue('1 g = 0.001 kg').setFontWeight('bold');
  sh.getRange(fuss, 1, 2, 4)
    .setBorder(true, true, true, true, true, true, '#000000', RAND);

  if (kopf.Bemerkung) {
    sh.getRange(fuss + 3, 1).setValue('Bemerkung: ' + kopf.Bemerkung);
  }
  sh.getRange(fuss + 4, 1).setValue(kopf.WeNr).setFontSize(8).setFontColor('#808080');

  sh.setFrozenRows(kopfZeile);
}

function ordnerFuerMonat() {
  const wurzel = String(parameter('ArchivOrdner') || '').trim();
  if (!wurzel) return null;
  return unterordner(DriveApp.getFolderById(wurzel), fmt(new Date(), 'yyyy-MM'));
}

function unterordner(eltern, name) {
  const vorhanden = eltern.getFoldersByName(name);
  return vorhanden.hasNext() ? vorhanden.next() : eltern.createFolder(name);
}

/* ============================================================
   9) Foto des Lieferscheins
   ============================================================ */

/**
 * Legt das Bild in Drive ab und gibt den Link zurueck.
 * In die Zelle kaeme es nicht — Sheets begrenzt sie auf 50'000 Zeichen.
 */
function fotoAblegen(dataUrl, weNr, u) {
  try {
    const wurzel = String(parameter('FotoOrdner') || '').trim();
    if (!wurzel) return '';
    const teile = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!teile) return '';

    const ordner = unterordner(DriveApp.getFolderById(wurzel), fmt(new Date(), 'yyyy-MM'));
    const blob = Utilities.newBlob(
      Utilities.base64Decode(teile[2]), teile[1], weNr + '_Lieferschein.jpg'
    );
    return ordner.createFile(blob).getUrl();
  } catch (err) {
    // Ein fehlgeschlagenes Foto darf die Erfassung nicht verhindern.
    console.error('Foto: ' + err);
    return '';
  }
}

/* ============================================================
   10) Benutzerverwaltung
   ============================================================ */

function adminListe() {
  const dat = blatt(T.benutzer).getDataRange().getValues();
  const k   = spalten(dat[0]);
  const aus = [];
  for (let i = 1; i < dat.length; i++) {
    if (!String(dat[i][k.Email] || '').trim()) continue;
    aus.push({
      email: String(dat[i][k.Email]).trim().toLowerCase(),
      name: String(dat[i][k.Name] || ''),
      aktiv: String(dat[i][k.Aktiv]).toLowerCase() !== 'false',
      admin: String(dat[i][k.Rolle] || '') === 'admin',
      neu: String(dat[i][k.PwGeaendert]).toLowerCase() !== 'true',
      gesperrt: !!(dat[i][k.GesperrtBis] && new Date(dat[i][k.GesperrtBis]) > new Date())
    });
  }
  return { ok: true, benutzer: aus };
}

function adminNeu(d, u) {
  const email = String(d.email || '').trim().toLowerCase();
  const name  = String(d.name || '').trim();
  if (!email || !name) return { ok: false, error: 'unvollstaendig' };

  const bl  = blatt(T.benutzer);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Email]).trim().toLowerCase() === email) {
      return { ok: false, error: 'existiert' };
    }
  }

  const pass = zufall(10);
  const salt = zufall(16);
  const z = new Array(bl.getLastColumn()).fill('');
  z[k.Email]       = email;
  z[k.Name]        = name;
  z[k.PassHash]    = hash(pass, salt);
  z[k.Salt]        = salt;
  z[k.Aktiv]       = true;
  z[k.Fehler]      = 0;
  z[k.PwGeaendert] = false;
  z[k.Rolle]       = '';
  bl.appendRow(z);

  const text = zugangText(name, pass);
  if (d.mail) MailApp.sendEmail(email, 'Zugang Wareneingang', text);
  return { ok: true, passwort: pass, text: text, wem: name + ' <' + email + '>' };
}

function adminAktion(d, u) {
  const email = String(d.email || '').trim().toLowerCase();
  const was   = String(d.was || '');

  // Ohne diese Sperre koennte ein Fehlgriff die Firma ohne Admin lassen.
  if (email === u.email && (was === 'aus' || was === 'kein_admin')) {
    return { ok: false, error: 'nicht_selbst' };
  }

  const bl  = blatt(T.benutzer);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.Email, email, true);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };
  const zeile = i + 1;

  switch (was) {
    case 'aus':
      bl.getRange(zeile, k.Aktiv + 1).setValue(false);
      sitzungenLoeschen(email);
      return { ok: true };
    case 'an':
      bl.getRange(zeile, k.Aktiv + 1).setValue(true);
      bl.getRange(zeile, k.Fehler + 1).setValue(0);
      bl.getRange(zeile, k.GesperrtBis + 1).setValue('');
      return { ok: true };
    case 'admin':
      bl.getRange(zeile, k.Rolle + 1).setValue('admin');
      return { ok: true };
    case 'kein_admin':
      bl.getRange(zeile, k.Rolle + 1).setValue('');
      return { ok: true };
    case 'passwort': {
      const pass = zufall(10);
      const salt = zufall(16);
      bl.getRange(zeile, k.Salt + 1).setValue(salt);
      bl.getRange(zeile, k.PassHash + 1).setValue(hash(pass, salt));
      bl.getRange(zeile, k.PwGeaendert + 1).setValue(false);
      bl.getRange(zeile, k.Fehler + 1).setValue(0);
      bl.getRange(zeile, k.GesperrtBis + 1).setValue('');
      sitzungenLoeschen(email);
      const name = String(dat[i][k.Name] || '');
      const text = zugangText(name, pass);
      if (d.mail) MailApp.sendEmail(email, 'Neues Passwort Wareneingang', text);
      return { ok: true, passwort: pass, text: text, wem: name + ' <' + email + '>' };
    }
  }
  return { ok: false, error: 'unbekannte Aktion' };
}

function zugangText(name, pass) {
  return [
    'Guten Tag ' + name,
    '',
    'Der Wareneingang wird neu direkt am Gerät erfasst.',
    '',
    'Adresse:  ' + PWA_URL,
    'Passwort: ' + pass,
    '',
    'Bitte auf dem iPad in Safari öffnen und anmelden. Beim ersten Mal',
    'wählen Sie ein eigenes Passwort — das zugestellte gilt nur bis dahin.',
    '',
    'Für das Symbol auf dem Home-Bildschirm: unten auf «Teilen» tippen,',
    'dann «Zum Home-Bildschirm».',
    '',
    'Freundliche Grüsse'
  ].join('\n');
}

/* ============================================================
   11) CSV fuer Excel / Power Query
   ============================================================ */

function csvExport() {
  const wd = blatt(T.we).getDataRange().getValues();
  const wk = spalten(wd[0]);
  const kopf = {};
  for (let i = 1; i < wd.length; i++) {
    if (String(wd[i][wk.Storniert]).toLowerCase() === 'true') continue;
    kopf[String(wd[i][wk.WeNr])] = wd[i];
  }

  const pd = blatt(T.pos).getDataRange().getValues();
  const pk = spalten(pd[0]);
  const aus = [[
    'WeNr', 'Datum', 'Zeit', 'Kunde', 'Lieferant', 'Nr', 'Artikel',
    'Anzahl', 'KG', 'MHD', 'Regalplatz', 'Bestehend', 'Bemerkung',
    'Angenommen', 'Gezaehlt', 'Eingelagert'
  ]];

  for (let i = 1; i < pd.length; i++) {
    const w = kopf[String(pd[i][pk.WeNr])];
    if (!w) continue;
    aus.push([
      w[wk.WeNr], w[wk.AngDat], w[wk.AngZeit], w[wk.Kunde], w[wk.Lieferant],
      pd[i][pk.Nr], pd[i][pk.Artikel], pd[i][pk.Anzahl], pd[i][pk.KG],
      pd[i][pk.MHD], pd[i][pk.Regalplatz],
      String(pd[i][pk.Bestehend]).toLowerCase() === 'true' ? 'X' : '',
      pd[i][pk.Bemerkung], w[wk.AngNam], w[wk.GezNam], w[wk.EinNam]
    ]);
  }

  return aus.map(z => z.map(feld => {
    const s = String(feld == null ? '' : feld);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}

/* ============================================================
   12) Hilfsmittel
   ============================================================ */

function blatt(name) {
  const bl = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!bl) throw new Error('Blatt fehlt: ' + name);
  return bl;
}

/** Spaltennamen -> Index. Die Reihenfolge in der Tabelle ist damit egal. */
function spalten(kopfzeile) {
  const k = {};
  kopfzeile.forEach((name, i) => {
    const s = String(name || '').trim();
    if (s) k[s] = i;
  });
  return k;
}

function zeileFinden(dat, spalte, wert, klein) {
  const suche = klein ? String(wert).toLowerCase() : String(wert);
  for (let i = 1; i < dat.length; i++) {
    const ist = klein ? String(dat[i][spalte]).trim().toLowerCase() : String(dat[i][spalte]);
    if (ist === suche) return i;
  }
  return -1;
}

function parameter(schluessel) {
  const dat = blatt(T.parameter).getDataRange().getValues();
  const k   = spalten(dat[0]);
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Schluessel]).trim() === schluessel) {
      return String(dat[i][k.Wert]).trim();
    }
  }
  return '';
}

function hash(pass, salt) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pass)
  );
}

function zufall(n) {
  const z = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let aus = '';
  for (let i = 0; i < n; i++) aus += z.charAt(Math.floor(Math.random() * z.length));
  return aus;
}

function fmt(d, muster) {
  return Utilities.formatDate(d, ZEITZONE, muster);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   13) Einrichtung — im Editor ausfuehren, nicht ueber die App
   ============================================================ */

/** Legt alle Blaetter mit den richtigen Kopfzeilen an. Einmalig. */
function setupAnlegen() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const plan = {};
  plan[T.we] = ['WeNr', 'Zeitstempel', 'Erfasser', 'Email', 'Kunde', 'Lieferant',
                'AngNam', 'AngDat', 'AngZeit', 'GezNam', 'GezDat', 'GezZeit',
                'EinNam', 'EinDat', 'EinZeit', 'LagerM2', 'Bemerkung',
                'Storniert', 'Status', 'FotoUrl', 'DateiUrl', 'Gesendet'];
  plan[T.pos] = ['WeNr', 'Nr', 'Artikel', 'Anzahl', 'KG', 'MHD',
                 'Regalplatz', 'Bemerkung', 'Bestehend'];
  plan[T.kunden]      = ['Name', 'Aktiv', 'Sortierung'];
  plan[T.lieferanten] = ['Name', 'Aktiv', 'Sortierung'];
  plan[T.benutzer]    = ['Email', 'Name', 'PassHash', 'Salt', 'Aktiv', 'Fehler',
                         'GesperrtBis', 'LetzterLogin', 'PwGeaendert', 'Rolle'];
  plan[T.sessions]    = ['Token', 'Email', 'GueltigBis'];
  plan[T.parameter]   = ['Schluessel', 'Wert', 'GueltigAb'];

  Object.keys(plan).forEach(name => {
    let bl = ss.getSheetByName(name);
    if (!bl) bl = ss.insertSheet(name);
    if (bl.getLastRow() === 0) {
      bl.getRange(1, 1, 1, plan[name].length).setValues([plan[name]])
        .setFontWeight('bold');
      bl.setFrozenRows(1);
    }
  });

  // Datumsspalten als Text — sonst verschiebt Sheets sie ueber die Zeitzone.
  [[T.we, 8], [T.we, 11], [T.we, 14], [T.pos, 6]].forEach(x => {
    ss.getSheetByName(x[0]).getRange(2, x[1], 5000).setNumberFormat('@');
  });

  const par = ss.getSheetByName(T.parameter);
  if (par.getLastRow() < 2) {
    par.getRange(2, 1, 3, 2).setValues([
      ['MailAn', ''],        // Adresse, die das fertige Formular erhaelt
      ['ArchivOrdner', ''],  // Drive-Ordner-ID fuer die xlsx-Ablage
      ['FotoOrdner', '']     // Drive-Ordner-ID fuer Lieferschein-Fotos
    ]);
  }
  return 'fertig';
}

/** Erstzugang: in «Benutzer» nur Email und Name eintragen, dann hier starten. */
function zugangVerschicken() {
  const bl  = blatt(T.benutzer);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  let n = 0;

  for (let i = 1; i < dat.length; i++) {
    const email = String(dat[i][k.Email] || '').trim().toLowerCase();
    if (!email || String(dat[i][k.PassHash] || '').trim()) continue;

    const pass = zufall(10);
    const salt = zufall(16);
    bl.getRange(i + 1, k.Salt + 1).setValue(salt);
    bl.getRange(i + 1, k.PassHash + 1).setValue(hash(pass, salt));
    bl.getRange(i + 1, k.Aktiv + 1).setValue(true);
    bl.getRange(i + 1, k.Fehler + 1).setValue(0);
    bl.getRange(i + 1, k.PwGeaendert + 1).setValue(false);

    MailApp.sendEmail(email, 'Zugang Wareneingang',
      zugangText(String(dat[i][k.Name] || ''), pass));
    n++;
  }
  return n + ' Zugang/Zugaenge verschickt';
}

/** Woechentliche Sicherung — an einen Zeit-Trigger haengen. */
function sicherung() {
  const wurzel = String(parameter('ArchivOrdner') || '').trim();
  if (!wurzel) return;
  const ordner = unterordner(DriveApp.getFolderById(wurzel), 'Sicherung');
  DriveApp.getFileById(SHEET_ID)
    .makeCopy('Wareneingang ' + fmt(new Date(), 'yyyy-MM-dd'), ordner);
}
