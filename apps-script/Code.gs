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
   1) Konfiguration — in den Skripteigenschaften, nicht hier
   ============================================================ */

/**
 * Die drei Werte, die eine Installation ausmachen, stehen NICHT im Code:
 *
 *   SHEET_ID     ID der Tabelle, aus der URL zwischen /d/ und /edit
 *   PWA_URL      Adresse der PWA, kommt in die Zugangsmails
 *   TOKEN_READ   schuetzt den CSV-Export
 *
 * Sie liegen in den Skripteigenschaften: **Projekteinstellungen →
 * Skripteigenschaften → Skripteigenschaft hinzufuegen**. Einmal eintragen,
 * danach nie wieder — auch nicht, wenn der ganze Code ersetzt wird. Das
 * spart bei jeder Aktualisierung drei Felder, und ein oeffentliches Repo
 * traegt kein Token.
 *
 * Zum Pruefen: einrichtungPruefen() im Editor ausfuehren.
 * Fuer ein starkes Token: tokenErzeugen() ausfuehren.
 *
 * @param darfFehlen  true: ein leerer Wert ist in Ordnung und kommt als ''
 *                    zurueck. Sonst gibt es eine Meldung, die sagt, wo der
 *                    Wert hingehoert — statt eines stillen Fehlschlags.
 */
function eigenschaft(name, darfFehlen) {
  // Einmal je Ausfuehrung lesen: blatt() ruft das hier bei jedem Zugriff.
  if (!eigenschaft._alle) {
    eigenschaft._alle = PropertiesService.getScriptProperties().getProperties();
  }
  const wert = String(eigenschaft._alle[name] || '').trim();
  if (!wert && !darfFehlen) {
    throw new Error('Skripteigenschaft «' + name + '» fehlt — ' +
                    'Projekteinstellungen → Skripteigenschaften.');
  }
  return wert;
}

/* Blattnamen — nur aendern, wenn die Tabelle anders heisst. */
const T = {
  we:          'Wareneingang',
  pos:         'Positionen',
  kontakte:    'Kontakte',
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

/**
 * Zeitmessung. Nicht Zierde, sondern die Voraussetzung dafuer, ueberhaupt
 * das Richtige zu optimieren.
 *
 * In Apps Script kostet der Weg zum Server ein Vielfaches der Arbeit dort:
 * der POST auf /exec wird weitergeleitet, die Antwort kommt von einem
 * zweiten Host, und der Skriptstart kann kalt sein. Ohne diese Zahl sieht
 * ein langsamer Aufruf immer nach einem langsamen Server aus, und man baut
 * an der falschen Stelle um. Die App zieht «Server» von ihrer eigenen
 * Wanduhr ab; was bleibt, ist der Weg.
 *
 * Jede Ausfuehrung hat ihre eigenen Globals — hier kann sich nichts
 * zwischen zwei Aufrufen vermischen.
 */
const UHR = { t0: 0, teile: [] };

function uhrStart() { UHR.t0 = Date.now(); UHR.teile = []; }

function uhrPunkt(name, seit) {
  UHR.teile.push(name + ' ' + (Date.now() - seit));
}

/** Haengt die Messung an die Antwort, ohne je ein Feld zu ueberschreiben. */
function uhrAnhaengen(r) {
  if (!r || typeof r !== 'object') return r;
  r.ms = Date.now() - UHR.t0;
  if (UHR.teile.length) r.teile = UHR.teile.join(' ');
  return r;
}

function doPost(e) {
  uhrStart();
  try {
    const d = JSON.parse(e.postData.contents);
    return json(uhrAnhaengen(verteilen(d)));
  } catch (err) {
    return json(uhrAnhaengen({ ok: false, error: String(err) }));
  }
}

/**
 * GET dient ausschliesslich dem CSV-Export fuer Excel. Die App selbst spricht
 * nur ueber POST — sonst stuende der Sitzungstoken in der Adresse und damit
 * in den Ausfuehrungsprotokollen, im Verlauf des Browsers und in jedem
 * Zwischenspeicher, der Adressen mitschreibt.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.format !== 'csv') {
    // Hierher kommt auch die App, wenn Apps Script ihren POST weiterleitet
    // und der Browser der Weiterleitung mit GET folgt — dabei geht der Rumpf
    // verloren. Das Skript hat dann nichts getan, und die Antwort sagt genau
    // das, als JSON: die App erkennt es und schickt den Aufruf noch einmal.
    // Als blosser Text sah es fuer sie aus wie eine kaputte Bereitstellung.
    return json({ ok: false, error: 'nur_post',
                  hinweis: 'Diese Adresse liefert nur den CSV-Export: ' +
                           '?token=…&format=csv' });
  }

  const token = eigenschaft('TOKEN_READ', true);
  if (!token || p.token !== token) {
    return ContentService.createTextOutput('kein Zugriff');
  }
  return ContentService.createTextOutput(csvExport(p))
    .setMimeType(ContentService.MimeType.CSV);
}

/** Eine Stelle, an der entschieden wird, was eine Aktion darf. */
function verteilen(d) {
  const aktion = d.action || 'we_speichern';

  // ohne Sitzung erreichbar
  if (aktion === 'login') return login(d);

  const tAuth = Date.now();
  const u = sitzungPruefen(d.session);
  uhrPunkt('auth', tAuth);
  if (!u) return { ok: false, error: 'session' };

  // Solange das zugestellte Passwort nicht ersetzt ist, geht nur der Wechsel
  // — abmelden bleibt trotzdem erlaubt, sonst sitzt man auf dem Geraet fest.
  if (!u.pwGeaendert && aktion !== 'passwort' && aktion !== 'abmelden') {
    return { ok: false, error: 'passwort_noetig' };
  }

  const tAktion = Date.now();
  try {
    return ausfuehren(aktion, d, u);
  } finally {
    uhrPunkt(aktion, tAktion);
  }
}

function ausfuehren(aktion, d, u) {
  switch (aktion) {
    case 'start':         return startDaten(d, u);
    case 'passwort':      return passwortSetzen(d, u);
    case 'abmelden':      return abmelden(d, u);
    case 'stammdaten':    return stammdaten();
    case 'we_speichern':  return weSpeichern(d, u);
    case 'we_schritt':    return weSchritt(d, u);
    case 'we_liste':      return weListe(d, u);
    case 'we_detail':     return weDetail(d, u);
    case 'we_foto':       return weFoto(d, u);
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
      case 'admin_parameter': return adminParameter(d, u);
      case 'admin_stamm':     return adminStamm();
      case 'admin_kontakt':   return adminKontakt(d);
      case 'admin_kunde':     return adminKunde(d);
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
    const bis      = dat[i][k.GesperrtBis];
    const gesperrt = !!(bis && new Date(bis) > new Date());

    // Eine abgelaufene Sperre gibt wieder volle Versuche. Ohne das steht der
    // Zaehler weiter auf fuenf, und der erste Tippfehler nach der Wartezeit
    // sperrt sofort erneut.
    let fehler = Number(dat[i][k.Fehler] || 0);
    if (bis && !gesperrt && fehler) {
      fehler = 0;
      bl.getRange(zeile, k.Fehler + 1).setValue(0);
      bl.getRange(zeile, k.GesperrtBis + 1).setValue('');
    }

    const salt = String(dat[i][k.Salt] || '');
    const soll = String(dat[i][k.PassHash] || '');
    if (!hashPasst(pass, salt, soll)) {
      fehler++;
      bl.getRange(zeile, k.Fehler + 1).setValue(fehler);
      if (fehler >= MAX_FEHLER) {
        bl.getRange(zeile, k.GesperrtBis + 1)
          .setValue(new Date(Date.now() + SPERRE_MINUTEN * 60000));
      }
      return { ok: false, error: 'login' };
    }

    // Ab hier stimmt das Passwort. Erst jetzt darf die Antwort mehr sagen als
    // «falsch»: wer es nicht kennt, erfaehrt nicht einmal, ob es das Konto
    // gibt — «inaktiv» oder «gesperrt» waeren sonst die Bestaetigung.
    if (gesperrt) return { ok: false, error: 'gesperrt' };
    if (String(dat[i][k.Aktiv]).toLowerCase() === 'false') {
      return { ok: false, error: 'inaktiv' };
    }

    // Alte Fassung im Vorbeigehen ersetzen: hier liegt das Passwort im
    // Klartext vor, spaeter nie wieder.
    if (soll.indexOf(HASH_MARKE) !== 0) {
      bl.getRange(zeile, k.PassHash + 1).setValue(hash(pass, salt));
    }

    bl.getRange(zeile, k.Fehler + 1).setValue(0);
    bl.getRange(zeile, k.GesperrtBis + 1).setValue('');
    bl.getRange(zeile, k.LetzterLogin + 1).setValue(new Date());

    const pwGeaendert = String(dat[i][k.PwGeaendert]).toLowerCase() === 'true';
    const antwort = {
      ok: true,
      session: sitzungAnlegen(email),
      name: String(dat[i][k.Name] || ''),
      rolle: String(dat[i][k.Rolle] || ''),
      pwGeaendert: pwGeaendert
    };

    // Die Startdaten gleich mitgeben: sonst folgt auf das Anmelden sofort
    // ein zweiter Aufruf fuer genau diese Zeilen, und der Weg dorthin
    // kostet mehr als das Lesen selbst. Wer sein Passwort noch wechseln
    // muss, bekommt sie nicht — er sieht die Liste ohnehin nicht, und
    // verteilen() laesst ihn bis dahin an keine andere Aktion.
    if (pwGeaendert) {
      const u = { email: email, name: antwort.name, rolle: antwort.rolle,
                  pwGeaendert: true, zeile: zeile };
      // d traegt «alle» mit, falls der Admin die Ansicht eingeschaltet hat —
      // sonst kaeme hier die kurze Liste zurueck und wuerde als die ganze
      // angezeigt und gemerkt.
      antwort.start = startDaten(d, u);
    }
    return antwort;
  }
  return { ok: false, error: 'login' };
}

function sitzungAnlegen(email) {
  const token = zufall(32);
  const bl    = blatt(T.sessions);

  // Abgelaufene Zeilen bei dieser Gelegenheit wegraeumen. Das Blatt wird bei
  // jedem einzelnen Aufruf ganz gelesen; ohne das waechst es ewig weiter,
  // und mit ihm die Zeit, die jede Aktion braucht. Anmelden ist selten —
  // der richtige Moment dafuer.
  const dat   = bl.getDataRange().getValues();
  const jetzt = new Date();
  for (let i = dat.length - 1; i >= 1; i--) {
    if (dat[i][2] && new Date(dat[i][2]) < jetzt) bl.deleteRow(i + 1);
  }

  bl.appendRow([token, email, new Date(Date.now() + SITZUNG_TAGE * 86400000)]);
  return token;
}

/**
 * Meldet dieses eine Geraet ab. Der Token wird geloescht, nicht nur im
 * Browser vergessen: sonst bliebe eine abgemeldete Sitzung dreissig Tage
 * lang gueltig, und «Abmelden» auf einem geteilten iPad waere eine Geste.
 */
function abmelden(d, u) {
  CacheService.getScriptCache().remove(sitzungCacheSchluessel(d.session));
  const bl  = blatt(T.sessions);
  const dat = bl.getDataRange().getValues();
  for (let i = dat.length - 1; i >= 1; i--) {
    if (String(dat[i][0]) === String(d.session)) bl.deleteRow(i + 1);
  }
  return { ok: true };
}

/**
 * Wie lange eine gepruefte Sitzung gemerkt wird.
 *
 * Jeder einzelne Aufruf las bisher ZWEI Blaetter — «Sessions» und
 * «Benutzer» — nur um zu erfahren, wer da schreibt. Gemessen an der
 * lebenden Tabelle kostet ein Lesevorgang rund 330 ms; das waren zwei
 * Drittel einer Sekunde auf jedem Aufruf, immer mit derselben Antwort.
 *
 * Eine Minute ist kurz genug, dass eine von Hand in der Tabelle
 * vorgenommene Aenderung nicht lange nachhaengt, und lang genug, dass
 * eine Arbeitsstrecke sie nicht staendig neu bezahlt. Alles, was die App
 * SELBST an einem Benutzer aendert — abmelden, deaktivieren, Rolle,
 * Passwort — raeumt den Eintrag sofort weg, sodass dort nichts
 * nachhaengt.
 */
const SITZUNG_CACHE_SEK = 60;

function sitzungCacheSchluessel(token) { return 'sitz_' + String(token); }

/**
 * Vergisst die gemerkten Sitzungen dieses Benutzers.
 *
 * Muss laufen, BEVOR die Zeilen aus «Sessions» verschwinden — danach ist
 * nicht mehr zu finden, welche Token ihm gehoerten.
 */
function sitzungCacheLeeren(email) {
  const gesucht = String(email || '').trim().toLowerCase();
  if (!gesucht) return;
  const dat = blatt(T.sessions).getDataRange().getValues();
  const weg = [];
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][1]).trim().toLowerCase() === gesucht) {
      weg.push(sitzungCacheSchluessel(dat[i][0]));
    }
  }
  if (weg.length) CacheService.getScriptCache().removeAll(weg);
}

/**
 * Liest mehrere Blaetter auf einmal — der Leseweg fuer alles, was nur
 * ansieht und nichts schreibt.
 *
 * An der lebenden Tabelle gemessen: fuenf Lesevorgaenge ueber
 * SpreadsheetApp brauchen im Median 1631 ms und davor 317 ms fuers
 * Oeffnen; dieselben Daten ueber `Sheets.Spreadsheets.Values.batchGet`
 * 209 ms, und geoeffnet wird dabei gar nichts.
 *
 * Gilt NICHT fuer Blaetter, an denen Datumsvergleiche haengen —
 * «Sessions» und «Benutzer» bleiben bei SpreadsheetApp. batchGet gaebe
 * `GueltigBis` als «10/10/2026 19:11:27» zurueck, und das amerikanisch zu
 * lesen funktioniert, bis es eines Tages anders gelesen wird. Der Cache
 * aus Abschnitt 3 macht diese beiden Lesevorgaenge ohnehin selten.
 *
 * Und nicht fuers Schreiben: wer eine Zeile sucht, um sie zu aendern,
 * liest sie weiter ueber SpreadsheetApp — dieselbe Quelle, aus der er
 * gleich schreibt.
 *
 * Ohne den erweiterten Dienst faellt das hier auf SpreadsheetApp zurueck:
 * langsamer und richtig, statt einer App, die wegen einer Einstellung
 * nicht startet.
 */
function datenLesen(namen) {
  if (typeof Sheets !== 'undefined') {
    try {
      const b = batchLesen(namen);
      // batchGet liefert fuer ein fehlendes Blatt gar keinen Bereich; der
      // Aufrufer bekaeme undefined statt einer leeren Tabelle.
      namen.forEach(n => { if (!b[n]) b[n] = []; });
      return b;
    }
    catch (e) {
      console.warn('batchGet nicht moeglich (' + e.message +
                   ') — gelesen wird ueber SpreadsheetApp.');
    }
  }
  const aus = {};
  namen.forEach(n => {
    // Ein Blatt, das es nicht gibt, gilt hier als leer — NICHT als Fehler.
    // Wer die neue Fassung einspielt und setupAnlegen noch nicht laufen
    // liess, dem fehlt «Kontakte»; mit blatt() waere der Anmeldeschirm tot,
    // weil startDaten am Anmelden mit dranhaengt. einrichtungPruefen()
    // nennt fehlende Blaetter beim Namen — das ist der Ort dafuer.
    const bl = tabelle().getSheetByName(n);
    if (!bl) {
      console.warn('Blatt fehlt, wird als leer gelesen: ' + n + ' — setupAnlegen()');
      aus[n] = [];
      return;
    }
    aus[n] = bl.getDataRange().getValues();
  });
  return aus;
}

/** Gibt den Benutzer zurueck oder null. Einzige Quelle fuer die Identitaet. */
function sitzungPruefen(token) {
  if (!token) return null;

  const cache = CacheService.getScriptCache();
  const gemerkt = cache.get(sitzungCacheSchluessel(token));
  if (gemerkt) {
    try { return JSON.parse(gemerkt); } catch (e) { /* beschaedigt, neu lesen */ }
  }

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
    const u = {
      email: email,
      name: String(bd[i][k.Name] || ''),
      rolle: String(bd[i][k.Rolle] || ''),
      pwGeaendert: String(bd[i][k.PwGeaendert]).toLowerCase() === 'true',
      zeile: i + 1
    };
    cache.put(sitzungCacheSchluessel(token), JSON.stringify(u), SITZUNG_CACHE_SEK);
    return u;
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

  // Die Zeile hier suchen statt der gemerkten Nummer zu glauben: seit die
  // Sitzung aus dem Cache kommen kann, ist «zeile» ein Wert von vorhin.
  // Eine falsche Zeilennummer schriebe ein fremdes Passwort.
  const i = zeileFinden(dat, k.Email, u.email, true);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };
  const zeile = i + 1;

  if (!hashPasst(alt, String(dat[i][k.Salt] || ''), dat[i][k.PassHash])) {
    return { ok: false, error: 'alt_falsch' };
  }

  const salt = zufall(16);
  bl.getRange(zeile, k.Salt + 1).setValue(salt);
  bl.getRange(zeile, k.PassHash + 1).setValue(hash(neu, salt));
  bl.getRange(zeile, k.PwGeaendert + 1).setValue(true);

  // Ein Passwortwechsel meldet alle Geraete ab — auch ein verlorenes.
  sitzungenLoeschen(u.email);
  return { ok: true, session: sitzungAnlegen(u.email) };
}

function sitzungenLoeschen(email) {
  const gesucht = String(email || '').trim().toLowerCase();
  const bl  = blatt(T.sessions);
  const dat = bl.getDataRange().getValues();
  // Token einsammeln und Zeilen loeschen im SELBEN Durchgang: ein eigener
  // Aufruf las das Blatt noch einmal, und ein Lesevorgang kostet hier rund
  // 330 ms.
  const weg = [];
  for (let i = dat.length - 1; i >= 1; i--) {
    if (String(dat[i][1]).trim().toLowerCase() !== gesucht) continue;
    weg.push(sitzungCacheSchluessel(dat[i][0]));
    bl.deleteRow(i + 1);
  }
  if (weg.length) CacheService.getScriptCache().removeAll(weg);
}

/* ============================================================
   4) Stammdaten
   ============================================================ */

/** Die Blaetter, aus denen die Stammdaten kommen. */
const STAMM_BLAETTER = [T.kunden, T.lieferanten, T.kontakte];

/**
 * EINE Stelle, die sagt, was Stammdaten sind.
 *
 * Es gab zwei: «stammdaten» und «startDaten» bauten ihre Antwort je fuer
 * sich. Als die Kontakte dazukamen, bekam nur die erste sie — und die App
 * ruft die zweite. Im Sendedialog stand dann «nichts hinterlegt», obwohl
 * es in der Tabelle stand. Zwei Listen derselben Sache laufen auseinander,
 * frueher oder spaeter.
 */
function stammdatenAus(daten) {
  return {
    kunden: listeAktiv(T.kunden, daten[T.kunden]),
    lieferanten: listeAktiv(T.lieferanten, daten[T.lieferanten]),
    kontakte: kontakteAktiv(daten[T.kontakte]),
    empfaenger: empfaengerJeKunde(daten[T.kunden])
  };
}

function stammdaten() {
  const daten = datenLesen(STAMM_BLAETTER);
  return Object.assign({ ok: true }, stammdatenAus(daten));
}

/** Aktive Kontakte als {name, email}. */
function kontakteAktiv(dat) {
  const aus = [];
  if (!dat || !dat.length) return aus;
  const k = spalten(dat[0]);
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Aktiv]).toLowerCase() === 'false') continue;
    const email = String(dat[i][k.Email] || '').trim();
    if (!email) continue;
    aus.push({ name: String(dat[i][k.Name] || '').trim(), email: email });
  }
  aus.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return aus;
}

/**
 * Die Vorgabe je Kunde, damit der Sendedialog sie ohne zweiten Weg zum
 * Server kennt. Nur Kunden, bei denen ueberhaupt etwas hinterlegt ist.
 */
function empfaengerJeKunde(dat) {
  const aus = {};
  if (!dat || !dat.length) return aus;
  const k = spalten(dat[0]);
  if (k.EmailHaupt == null) return aus;
  for (let i = 1; i < dat.length; i++) {
    const name = String(dat[i][k.Name] || '').trim();
    const an   = String(dat[i][k.EmailHaupt] || '').trim();
    const kop  = k.EmailVertretung != null
                   ? String(dat[i][k.EmailVertretung] || '').trim() : '';
    if (name && (an || kop)) aus[name] = { an: an, kopie: kop };
  }
  return aus;
}

/**
 * Alles, was die App beim Oeffnen braucht, in EINER Antwort.
 *
 * Bisher waren das zwei Aufrufe nacheinander — `we_liste`, dann
 * `stammdaten`. Nacheinander, weil zwei gleichzeitige Aufrufe fuer Apps
 * Script zwei Ausfuehrungen sind und die zweite mit einer Fehlerseite
 * zurueckkommen kann. Damit zahlte das Oeffnen den Weg zum Server zweimal,
 * und der Weg ist hier das Teure: Weiterleitung von /exec, Antwort von
 * einem zweiten Host, moeglicherweise kalter Skriptstart. Gemessen an
 * einem gleich gebauten Projekt sind das rund drei Sekunden je Aufruf,
 * waehrend die Arbeit im Skript in Millisekunden zaehlt.
 *
 * Ein Aufruf spart damit nicht nur den zweiten Weg, sondern auch die
 * zweite Sitzungspruefung — die liest sonst `Sessions` und `Benutzer`
 * ein zweites Mal.
 *
 * `we_liste` und `stammdaten` bleiben. Die Suche braucht die Liste allein,
 * und eine aeltere App muss sich weiter anmelden koennen.
 */
function startDaten(d, u) {
  // Alle Blaetter in EINER Anfrage. Getrennt gelesen waeren es vier.
  const daten = datenLesen([T.we].concat(STAMM_BLAETTER));
  const liste = weListe(d, u, daten[T.we]);
  if (!liste.ok) return liste;
  // Dieselbe Quelle wie «stammdaten» — nicht dieselben Zeilen noch einmal.
  return Object.assign({ ok: true, liste: liste.liste }, stammdatenAus(daten));
}

function listeAktiv(name, vorab) {
  const dat = vorab || datenLesen([name])[name];
  // Ein leeres Blatt ist truthy, und spalten(undefined) wirft — dann waere
  // die ganze Antwort ein TypeError statt einer leeren Liste.
  if (!dat || !dat.length) return [];
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
 * Die drei Quittungen des Papiers, in ihrer Reihenfolge. Abschnitt 5 setzt
 * sie beim Erfassen, Abschnitt 6 traegt sie nach — eine Tabelle fuer beide
 * Wege, damit keiner von ihnen eigene Spaltennamen erfindet.
 */
const SCHRITTE = {
  angenommen:  { nam: 'AngNam', dat: 'AngDat', zeit: 'AngZeit' },
  gezaehlt:    { nam: 'GezNam', dat: 'GezDat', zeit: 'GezZeit' },
  eingelagert: { nam: 'EinNam', dat: 'EinDat', zeit: 'EinZeit' }
};
const SCHRITT_FOLGE = ['angenommen', 'gezaehlt', 'eingelagert'];

/**
 * Legt einen Wareneingang an und quittiert dabei die Schritte, die der
 * Erfasser selbst getan hat — auf dem Papier unterschreibt jeder nur seine
 * Zeile, und wer im Buero nur abtippt, unterschreibt gar nichts. Ohne
 * Angabe bleibt es bei «Angenommen»: wer erfasst, hat die Ware angenommen.
 * Der Name kommt in jedem Fall aus der Sitzung, nie aus dem Request.
 */
function weSpeichern(d, u) {
  const kunde     = String(d.kunde || '').trim();
  const lieferant = String(d.lieferant || '').trim();
  const pos       = Array.isArray(d.positionen) ? d.positionen : [];
  const wunsch    = Array.isArray(d.schritte) ? d.schritte : ['angenommen'];
  const gewaehlt  = SCHRITT_FOLGE.filter(s => wunsch.indexOf(s) >= 0);

  if (!kunde && !lieferant) return { ok: false, error: 'kunde_lieferant' };
  if (!pos.length)          return { ok: false, error: 'keine_positionen' };

  const sperre = LockService.getScriptLock();
  sperre.waitLock(20000);
  try {
    // Derselbe Vorgang darf nicht zweimal in der Tabelle landen. Bricht die
    // Verbindung nach dem Schreiben ab, sieht der Erfasser einen Fehler und
    // speichert noch einmal — mit demselben Schluessel aus dem Formular.
    const schon = vorgangSuchen(d.vorgang);
    if (schon) return { ok: true, weNr: schon, wiederholt: true };

    const weNr = naechsteNummer();
    const jetzt = new Date();
    const datum = fmt(jetzt, 'yyyy-MM-dd');
    const zeit  = fmt(jetzt, 'HH:mm');

    const bl = blatt(T.we);
    const k  = kopfSpalten(bl);
    const z  = new Array(bl.getLastColumn()).fill('');

    z[k.WeNr]        = weNr;
    // Als TEXT, wie jede andere Zeit in dieser Tabelle. Als Date geschrieben
    // haengt sein Aussehen am Anzeigeformat der Spalte, und damit daran,
    // ueber welchen Weg gelesen wird: SpreadsheetApp gab «2026-09-11 08:41»,
    // batchGet «9/11/2026 08:41:10» — dieselbe Zelle, zwei Antworten.
    z[k.Zeitstempel] = fmt(jetzt, 'yyyy-MM-dd HH:mm');
    z[k.Erfasser]    = u.name;
    z[k.Email]       = u.email;
    z[k.Kunde]       = kunde;
    z[k.Lieferant]   = lieferant;
    gewaehlt.forEach(s => {
      z[k[SCHRITTE[s].nam]]  = u.name;
      z[k[SCHRITTE[s].dat]]  = datum;
      z[k[SCHRITTE[s].zeit]] = zeit;
    });
    z[k.LagerM2]     = zahl(d.lagerM2);
    z[k.Bemerkung]   = String(d.bemerkung || '').trim();
    z[k.Storniert]   = false;
    z[k.Status]      = statusAus(z, k);
    z[k.FotoUrl]     = d.foto ? fotoAblegen(d.foto, weNr + '_Lieferschein') : '';
    if (k.Vorgang != null) z[k.Vorgang] = String(d.vorgang || '').trim();
    bl.appendRow(z);

    positionenSchreiben(weNr, pos);
    return { ok: true, weNr: weNr };
  } finally {
    sperre.releaseLock();
  }
}

/**
 * Sucht den Schluessel eines Erfassungsvorgangs und gibt die Nummer zurueck,
 * unter der er schon steht. Liest nur diese eine Spalte.
 */
function vorgangSuchen(vorgang) {
  const schluessel = String(vorgang || '').trim();
  if (!schluessel) return '';
  const bl = blatt(T.we);
  const k  = kopfSpalten(bl);
  if (k.Vorgang == null || bl.getLastRow() < 2) return '';
  const spalte = bl.getRange(2, k.Vorgang + 1, bl.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < spalte.length; i++) {
    if (String(spalte[i][0]) === schluessel) {
      return String(bl.getRange(i + 2, k.WeNr + 1).getValue());
    }
  }
  return '';
}

function positionenSchreiben(weNr, pos) {
  const bl = blatt(T.pos);
  const k  = kopfSpalten(bl);
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
    // Das Komma ersetzt der Server selbst: die Umrechnung im Browser ist
    // Bequemlichkeit, keine Zusicherung — der Client kann alles schicken.
    z[k.Anzahl]     = zahl(p.anzahl);
    z[k.KG]         = zahl(p.kg);
    z[k.MHD]        = String(p.mhd || '').trim();
    z[k.Regalplatz] = String(p.regalplatz || '').trim();
    z[k.Bemerkung]  = String(p.bemerkung || '').trim();
    z[k.Bestehend]  = p.bestehend === true;
    // Der Dateiname ist die Artikelbezeichnung — so verlangt, und in Drive
    // ist das auch das Einzige, was einem Menschen etwas sagt. Zwei
    // Lieferungen desselben Artikels heissen dann gleich; gefunden wird ein
    // Foto ohnehin ueber die Zeile, nicht ueber den Namen.
    if (k.FotoUrl != null && p.bild) z[k.FotoUrl] = fotoAblegen(p.bild, artikel);
    zeilen.push(z);
  });

  if (zeilen.length) {
    bl.getRange(bl.getLastRow() + 1, 1, zeilen.length, breite).setValues(zeilen);
  }
}

/** Fortlaufend, pro Jahr: WE-2026-0001 */
function naechsteNummer() {
  const jahr = fmt(new Date(), 'yyyy');
  const bl   = blatt(T.we);
  const k    = kopfSpalten(bl);
  let max = 0;
  // Nur die Nummernspalte, nicht das ganze Blatt: das hier laeuft bei jeder
  // Erfassung, und die Tabelle waechst jedes Jahr.
  if (bl.getLastRow() > 1) {
    const spalte = bl.getRange(2, k.WeNr + 1, bl.getLastRow() - 1, 1).getValues();
    spalte.forEach(z => {
      const m = String(z[0] || '').match(/^WE-(\d{4})-(\d+)$/);
      if (m && m[1] === jahr) max = Math.max(max, Number(m[2]));
    });
  }
  return 'WE-' + jahr + '-' + String(max + 1).padStart(4, '0');
}

/* ============================================================
   6) Arbeitsschritte quittieren
   ============================================================ */

/**
 * Der Status ist der weiteste quittierte Schritt, nicht der zuletzt
 * geklickte: wer «Angenommen» nachtraegt, darf ein bereits eingelagertes
 * Dokument nicht wieder auf Anfang setzen.
 */
function statusAus(zeile, k) {
  let status = 'erfasst';
  SCHRITT_FOLGE.forEach(s => {
    if (String(zeile[k[SCHRITTE[s].nam]] || '').trim()) status = s;
  });
  return status;
}

/**
 * Traegt eine der drei Quittungen nach — auch «Angenommen», denn wer nur
 * abgetippt hat, muss die Annahme dem Kollegen ueberlassen koennen.
 * Der Name kommt aus der Sitzung, Datum und Zeit vom Server —
 * eine Quittung unter fremdem Namen ist so nicht moeglich.
 */
function weSchritt(d, u) {
  const feld = SCHRITTE[String(d.schritt || '')];
  if (!feld) return { ok: false, error: 'unbekannter Schritt' };

  // Unter Sperre, wie das Erfassen: sonst kommen zwei gleichzeitige Klicks
  // beide an der Pruefung «bereits quittiert» vorbei, und im Blatt steht
  // der Name dessen, der zufaellig zuletzt geschrieben hat.
  const sperre = LockService.getScriptLock();
  sperre.waitLock(20000);
  try {
    return schrittSchreiben(d, u, feld);
  } finally {
    sperre.releaseLock();
  }
}

function schrittSchreiben(d, u, feld) {
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
  dat[i][k[feld.nam]] = u.name;
  bl.getRange(i + 1, k.Status + 1).setValue(statusAus(dat[i], k));

  // Regalplaetze und Fotos traegt das zweite Team beim Einlagern nach —
  // dort steht die Ware vor einem, im Erfassungsbogen noch nicht.
  if (d.schritt === 'eingelagert' &&
      (Array.isArray(d.regalplaetze) || Array.isArray(d.bilder))) {
    regalplaetzeSchreiben(d.weNr, d.regalplaetze || [], d.bilder || []);
  }
  return { ok: true, name: u.name, datum: fmt(jetzt, 'yyyy-MM-dd'), zeit: fmt(jetzt, 'HH:mm') };
}

function regalplaetzeSchreiben(weNr, werte, bilder) {
  const bl  = blatt(T.pos);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.WeNr]) !== String(weNr)) continue;
    const nr = Number(dat[i][k.Nr]);
    const w  = (werte || [])[nr - 1];
    if (w != null && String(w).trim()) {
      bl.getRange(i + 1, k.Regalplatz + 1).setValue(String(w).trim());
    }

    // Ein Foto ersetzt hier nichts: steht schon eines in der Zeile, bleibt
    // es. Wer beim Einlagern knipst, ergaenzt, was beim Erfassen fehlte —
    // ueberschreiben hiesse, einen Beleg stillschweigend auszutauschen.
    const b = (bilder || [])[nr - 1];
    if (k.FotoUrl != null && b && !String(dat[i][k.FotoUrl] || '').trim()) {
      const url = fotoAblegen(b, String(dat[i][k.Artikel] || ''));
      if (url) bl.getRange(i + 1, k.FotoUrl + 1).setValue(url);
    }
  }
}

/* ============================================================
   7) Ansehen und zuruecknehmen
   ============================================================ */

/**
 * Die Uebersicht. Ohne Suche zeigt sie die eigenen Erfassungen und alles,
 * was beim Team noch offen ist — sonst koennte niemand quittieren, was ein
 * Kollege angenommen hat.
 *
 * Mit Suche gilt das nicht: dann wird der ganze Bestand durchsucht, auch
 * abgeschlossene Dokumente fremder Erfasser. Ohne das waere ein Beleg von
 * vorletztem Monat aus der App gar nicht mehr erreichbar — die Liste bricht
 * bei hundert Zeilen ab, und weDetail steht ohnehin jedem offen.
 *
 * `d.alle` hebt die Einschraenkung auch ohne Suche auf — fuer den Admin,
 * der wissen will, was das Team ueberhaupt erfasst hat, und nicht nur, was
 * noch offen ist. Ob jemand das darf, entscheidet der Server aus der Rolle
 * in der Sitzung: dass der Knopf beim gewoehnlichen Benutzer fehlt, ist
 * keine Sicherung — der Client kann alles schicken.
 */
function weListe(d, u, vorab) {
  const dat = vorab || datenLesen([T.we])[T.we];
  if (!dat || !dat.length) return { ok: true, liste: [] };
  const k   = spalten(dat[0]);
  const aus = [];
  const suche = String(d.suche || '').trim().toLowerCase();
  const alle  = !!d.alle && u.rolle === 'admin';

  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Storniert]).toLowerCase() === 'true') continue;

    if (suche) {
      const heuhaufen = [dat[i][k.WeNr], dat[i][k.Kunde], dat[i][k.Lieferant],
                         dat[i][k.Erfasser]].join(' ').toLowerCase();
      if (heuhaufen.indexOf(suche) < 0) continue;
    } else if (!alle && String(dat[i][k.Email]).trim().toLowerCase() !== u.email) {
      // trim(), weil die Adresse aus der Sitzung getrimmt ist und die aus
      // der Tabelle nicht. Ein Leerzeichen am Ende — von Hand eingetragen
      // oder mitkopiert — machte sonst aus dem eigenen abgeschlossenen
      // Eintrag einen fremden, und er verschwand aus der eigenen Liste.
      if (String(dat[i][k.Status]) === 'eingelagert') continue;
    }
    aus.push({
      weNr:      String(dat[i][k.WeNr]),
      datum:     feldText('AngDat', dat[i][k.AngDat]),
      zeit:      feldText('AngZeit', dat[i][k.AngZeit]),
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

/**
 * Ein Feld als Text. Ist die Spalte in der Tabelle nicht als Text formatiert,
 * macht Sheets aus dem geschriebenen «08:30» eine Uhrzeit und aus
 * «2026-09-09» ein Datum; zurueck kommt dann ein Zeitstempel, und in der App
 * stand «Sat Dec 30 1899 17:03:00». setupAnlegen verhindert den Fall fuer
 * neue Tabellen — das hier holt zurueck, was schon falsch drinsteht, und
 * bleibt die Bremse, falls jemand das Format wieder wegnimmt.
 */
/**
 * Ein Datum als yyyy-MM-dd, aus allem, was hier ankommen kann.
 *
 * feldText() allein genuegt dafuer nicht mehr: es heilt nur Date-Werte, und
 * ueber batchGet kommt gar kein Date an, sondern der ANGEZEIGTE Text der
 * Zelle — je nach Format «2026-09-10» oder «9/10/2026». Der Vergleich fuer
 * «&tage=» ist eine Zeichenkette gegen eine Zeichenkette; steht links das
 * amerikanische Format, ist er immer falsch und «&tage=» schneidet nichts
 * ab. Das ist genau der Fehler, den der alte String()-Vergleich hatte, nur
 * eine Etage weiter.
 *
 * Nur hier verwendet: fuer die Anzeige bleibt es bei feldText(), das den
 * Text unveraendert durchreicht.
 */
function alsDatum(wert) {
  if (wert instanceof Date) return fmt(wert, 'yyyy-MM-dd');
  const s = String(wert == null ? '' : wert).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const p = n => (n.length < 2 ? '0' + n : n);
    return us[3] + '-' + p(us[1]) + '-' + p(us[2]);
  }
  return s;
}

function feldText(name, wert) {
  if (!(wert instanceof Date)) return String(wert == null ? '' : wert);
  if (/Zeit$/.test(name))           return fmt(wert, 'HH:mm');
  if (/Dat$/.test(name) || name === 'MHD') return fmt(wert, 'yyyy-MM-dd');
  return fmt(wert, 'yyyy-MM-dd HH:mm');
}

function weDetail(d, u) {
  const daten = datenLesen([T.we, T.pos]);
  const dat = daten[T.we];
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };

  const kopf = {};
  Object.keys(k).forEach(name => { kopf[name] = feldText(name, dat[i][k[name]]); });

  return { ok: true, kopf: kopf, positionen: positionenLesen(d.weNr, daten[T.pos]) };
}

function positionenLesen(weNr, vorab) {
  const dat = vorab || datenLesen([T.pos])[T.pos];
  if (!dat || !dat.length) return [];
  const k   = spalten(dat[0]);
  const aus = [];
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.WeNr]) !== String(weNr)) continue;
    aus.push({
      nr:         Number(dat[i][k.Nr] || 0),
      artikel:    String(dat[i][k.Artikel] || ''),
      anzahl:     dat[i][k.Anzahl] === '' ? '' : Number(dat[i][k.Anzahl]),
      kg:         dat[i][k.KG] === '' ? '' : Number(dat[i][k.KG]),
      mhd:        feldText('MHD', dat[i][k.MHD]),
      regalplatz: String(dat[i][k.Regalplatz] || ''),
      bemerkung:  String(dat[i][k.Bemerkung] || ''),
      bestehend:  String(dat[i][k.Bestehend]).toLowerCase() === 'true',
      // Nur ob eines da ist. Die Adresse bleibt auf dem Server — im Browser
      // waere sie ein Drive-Link, und den kann der Lagermitarbeiter nicht
      // oeffnen (siehe weFoto).
      foto:       k.FotoUrl != null && !!String(dat[i][k.FotoUrl] || '').trim()
    });
  }
  aus.sort((a, b) => a.nr - b.nr);
  return aus;
}

/**
 * Gibt das Lieferscheinfoto zurueck, statt auf Drive zu verlinken.
 *
 * Der Link tat es nicht: er wird vom BROWSER geholt, mit dem Google-Konto,
 * an dem das Geraet gerade haengt. Rechte in dieser App sind keine Rechte
 * in Drive, und ein Lagermitarbeiter hat dort gar nichts zu suchen — er
 * sah «Zugriff verweigert» auf einem Beleg, der ihm gehoert.
 *
 * Die Web-App laeuft als «Ausfuehren als: Ich». Also liest das Skript die
 * Datei mit den Rechten des Eigentuemers und reicht die Bytes weiter; der
 * Browser spricht nie mit Drive. Damit kann der Ordner geschlossen bleiben.
 *
 * Die Datei-ID kommt AUS DER ZEILE, nie aus dem Aufruf. Sonst waere dies
 * ein Leseknopf fuer jede Datei, an die der Eigentuemer herankommt.
 */
function weFoto(d, u) {
  const dat = datenLesen([T.we])[T.we];
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };
  if (String(dat[i][k.Storniert]).toLowerCase() === 'true') {
    return { ok: false, error: 'storniert' };
  }

  // Ohne «nr» der Lieferschein, mit «nr» das Foto dieser Position. Beide
  // Adressen kommen aus der Tabelle, nie aus dem Aufruf.
  let quelle = String(dat[i][k.FotoUrl] || '');
  if (d.nr != null && String(d.nr) !== '') {
    quelle = '';
    const pd = datenLesen([T.pos])[T.pos];
    const pk = spalten(pd[0]);
    for (let j = 1; j < pd.length; j++) {
      if (String(pd[j][pk.WeNr]) !== String(d.weNr)) continue;
      if (String(pd[j][pk.Nr]) !== String(d.nr)) continue;
      quelle = pk.FotoUrl != null ? String(pd[j][pk.FotoUrl] || '') : '';
      break;
    }
  }

  const id = driveId(quelle);
  if (!id) return { ok: false, error: 'kein_foto' };

  try {
    const blob = DriveApp.getFileById(id).getBlob();
    return {
      ok: true,
      bild: 'data:' + blob.getContentType() + ';base64,' +
            Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    // Datei geloescht oder verschoben. Das ist etwas anderes als «kein
    // Foto erfasst», und der Unterschied gehoert auf den Schirm.
    console.error('Foto nicht lesbar (' + id + '): ' + e);
    return { ok: false, error: 'foto_unlesbar' };
  }
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
/**
 * Wer den Wareneingang eines Kunden bekommt.
 *
 * Beim Kunden stehen zwei Adressen: die Hauptadresse und die des
 * Stellvertreters. Beide sind Vorgabe — der Stellvertreter ist die Person,
 * die einspringt, und wer erst bei Abwesenheit erfaehrt, dass etwas
 * geliefert wurde, springt zu spaet ein. Wer es anders will, traegt im
 * Sendedialog etwas anderes ein; entschieden wird dort, nicht hier.
 */
function empfaengerFuer(kunde) {
  const dat = datenLesen([T.kunden])[T.kunden];
  const k   = spalten(dat[0]);
  if (k.EmailHaupt == null) return { an: '', kopie: '' };
  const i = zeileFinden(dat, k.Name, String(kunde || '').trim(), true);
  if (i < 0) return { an: '', kopie: '' };
  return {
    an:    String(dat[i][k.EmailHaupt] || '').trim(),
    kopie: k.EmailVertretung != null
             ? String(dat[i][k.EmailVertretung] || '').trim() : ''
  };
}

function weSenden(d, u) {
  const det = weDetail(d, u);
  if (!det.ok) return det;

  // Reihenfolge: was im Dialog steht, sonst was beim Kunden hinterlegt ist,
  // sonst die eine Adresse aus den Parametern. Die letzte ist der Rest aus
  // der Zeit, als es nur eine gab.
  // Erst nachsehen, wenn der Dialog nichts gesagt hat: sonst liest jeder
  // Versand das Kundenblatt fuer eine Antwort, die gleich verworfen wird.
  const eigenAn    = d.mailAn != null && String(d.mailAn).trim() !== '';
  const eigenKopie = d.kopie != null;
  let vorgabe = null;
  const nachsehen = () => (vorgabe || (vorgabe = empfaengerFuer(det.kopf.Kunde)));

  const empfaenger = String(
    eigenAn ? d.mailAn : (nachsehen().an || parameter('MailAn') || '')).trim();
  const kopie = String(eigenKopie ? d.kopie : nachsehen().kopie || '').trim();
  if (!empfaenger) return { ok: false, error: 'kein_empfaenger' };

  const name = det.kopf.WeNr + '_' +
               (det.kopf.Lieferant || det.kopf.Kunde || 'Wareneingang')
                 .replace(/[^\wÄÖÜäöüß -]/g, '').trim().replace(/\s+/g, '-');

  const blob = xlsxErzeugen(det.kopf, det.positionen, name);

  MailApp.sendEmail({
    to: empfaenger,
    cc: kopie || undefined,
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

  // Die Mail ist raus; der Vermerk darf daran nichts mehr aendern. Fehlt die
  // Zeile wider Erwarten, waere getRange(0, …) ein Fehler nach getaner Arbeit.
  const bl  = blatt(T.we);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.WeNr, d.weNr);
  if (i >= 0) {
    bl.getRange(i + 1, k.Gesendet + 1).setValue(fmt(new Date(), 'yyyy-MM-dd HH:mm'));
    if (url) bl.getRange(i + 1, k.DateiUrl + 1).setValue(url);
  }

  return { ok: true, an: empfaenger, kopie: kopie, url: url };
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
  sh.setColumnWidth(5, 130);   // MHD, und in Zeile 3-6 das Datum
  sh.setColumnWidth(6, 150);   // Regalplatz, und in Zeile 3-6 die Uhrzeit
  sh.setColumnWidth(7, 150);   // Bemerkungen
  sh.setColumnWidth(8, 90);    // Bestehend

  // --- Titel ---
  sh.getRange('A1').setValue('Wareneingang / Material reception')
    .setFontWeight('bold').setFontSize(12);

  // Die Nummer gehoert auf das Blatt, nicht nur in den Dateinamen: der
  // Ausdruck wird unterschrieben und abgelegt, und dann muss darauf stehen,
  // zu welcher Lieferung er gehoert.
  sh.getRange(1, 6).setValue(kopf.WeNr)
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('right');
  sh.getRange(1, 6, 1, 3).merge();

  // --- Quittungen ---
  // Die Beschriftungen des Papiers sind lang, Spalte A ist aber die schmale
  // N°-Spalte des Positionsblocks. Darum stehen die vier Felder auf
  // verbundenen Bereichen: A:B Aufgabe, C:D Name, E Datum, F Uhrzeit.
  const kt = [
    ['Aufgabe / Task', 'Name Mitarbeiter / Employee name',
     'Datum / Date', 'Uhrzeit / Time'],
    ['Angenommen / Accepted',                         kopf.AngNam, kopf.AngDat, kopf.AngZeit],
    ['Gezählt & kontrolliert / counted & controlled', kopf.GezNam, kopf.GezDat, kopf.GezZeit],
    ['Eingelagert / stored',                          kopf.EinNam, kopf.EinDat, kopf.EinZeit]
  ];
  kt.forEach((zeile, i) => {
    const r = 3 + i;
    sh.getRange(r, 1).setValue(zeile[0]);
    sh.getRange(r, 3).setValue(zeile[1]);
    sh.getRange(r, 5).setValue(zeile[2]);
    sh.getRange(r, 6).setValue(zeile[3]);
    sh.getRange(r, 1, 1, 2).merge();
    sh.getRange(r, 3, 1, 2).merge();
    sh.setRowHeight(r, 26);
  });
  sh.getRange(3, 1, 4, 6)
    .setBorder(true, true, true, true, true, true, '#000000', RAND)
    .setVerticalAlignment('middle').setWrap(true);
  sh.getRange(3, 1, 1, 6).setFontWeight('bold').setBackground(GRAU);
  sh.getRange(4, 1, 3, 1).setFontWeight('bold');

  sh.getRange('A8').setValue(
    'Artikelanzahl bitte direkt auf dem Lieferschein abhaken bzw. anpassen.\n' +
    'Please check off or adapt the article quantities directly on the delivery slip'
  ).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sh.getRange(8, 1, 1, 8).merge();
  sh.setRowHeight(8, 32);

  // --- Kunde / Lieferant ---
  // Gleiches Raster wie oben: Beschriftung auf A:B, Wert auf C:F.
  [[10, 'Kunde / Client', kopf.Kunde], [11, 'Lieferant / Supplier', kopf.Lieferant]]
    .forEach(x => {
      sh.getRange(x[0], 1).setValue(x[1]);
      sh.getRange(x[0], 3).setValue(x[2]);
      sh.getRange(x[0], 1, 1, 2).merge();
      sh.getRange(x[0], 3, 1, 4).merge();
      sh.setRowHeight(x[0], 22);
    });
  sh.getRange(10, 1, 2, 6)
    .setBorder(true, true, true, true, true, true, '#000000', RAND);
  sh.getRange(10, 1, 2, 1).setFontWeight('bold');

  sh.getRange('A13').setValue(
    'Bei neuem und bestehendem Material mit oder ohne Lieferschein notwendig:\n' +
    'For new and existing material with or without delivery slip needed'
  ).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sh.getRange(13, 1, 1, 8).merge();
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
/**
 * Ein Dateiname, der in Drive nicht stoert. Schraegstriche und Doppelpunkte
 * fliegen raus, Umlaute bleiben — sie stehen in Artikelbezeichnungen.
 */
function dateiname(name) {
  const sauber = String(name || '').replace(/[^\wÄÖÜäöüß .-]/g, '').trim();
  return sauber || 'Foto';
}

/**
 * Der Monatsordner, einmal je Ausfuehrung.
 *
 * fotoAblegen laeuft bei zehn bebilderten Positionen elfmal, und jeder
 * Aufruf las vorher das Parameterblatt und suchte den Ordner in Drive neu —
 * elf Lesevorgaenge und elf Ordnersuchen fuer ein Ergebnis, das sich
 * innerhalb eines Aufrufs nicht aendert.
 */
function fotoOrdnerHolen() {
  if (fotoOrdnerHolen._da) return fotoOrdnerHolen._ordner;
  fotoOrdnerHolen._da = true;
  fotoOrdnerHolen._ordner = null;
  const wurzel = String(parameter('FotoOrdner') || '').trim();
  if (!wurzel) return null;
  try {
    fotoOrdnerHolen._ordner =
      unterordner(DriveApp.getFolderById(wurzel), fmt(new Date(), 'yyyy-MM'));
  } catch (e) {
    console.error('Fotoordner nicht erreichbar: ' + e);
  }
  return fotoOrdnerHolen._ordner;
}

function fotoAblegen(dataUrl, name) {
  try {
    const teile = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!teile) return '';

    const ordner = fotoOrdnerHolen();
    if (!ordner) return '';
    // Endung nach dem wirklichen Typ: die App schickt JPEG, ein anderer
    // Client koennte PNG schicken, und eine falsche Endung faellt erst auf,
    // wenn jemand die Datei nicht oeffnen kann.
    const endung = (teile[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const blob = Utilities.newBlob(
      Utilities.base64Decode(teile[2]), teile[1],
      dateiname(name) + '.' + endung
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
  // Kontakte und Kunden gleich mit: der Adminbereich zeigt sie auf demselben
  // Schirm, und ein zweiter Weg zum Server kostet mehr als dieses Lesen.
  const stamm = adminStamm();
  return { ok: true, benutzer: aus,
           kontakte: stamm.kontakte, kunden: stamm.kunden };
}

/* ---------- Kontakte und Kunden ---------- */

/** Beides in einer Antwort: der Adminbereich zeigt sie nebeneinander. */
function adminStamm() {
  const daten = datenLesen([T.kontakte, T.kunden]);
  const kd = daten[T.kontakte] || [], kk = spalten(kd[0] || []);
  const kontakte = [];
  for (let i = 1; i < kd.length; i++) {
    const email = String(kd[i][kk.Email] || '').trim();
    if (!email) continue;
    kontakte.push({
      name: String(kd[i][kk.Name] || '').trim(),
      email: email,
      aktiv: String(kd[i][kk.Aktiv]).toLowerCase() !== 'false'
    });
  }

  const dd = daten[T.kunden] || [], dk = spalten(dd[0] || []);
  const kunden = [];
  for (let i = 1; i < dd.length; i++) {
    const name = String(dd[i][dk.Name] || '').trim();
    if (!name) continue;
    kunden.push({
      name: name,
      aktiv: String(dd[i][dk.Aktiv]).toLowerCase() !== 'false',
      haupt: dk.EmailHaupt != null ? String(dd[i][dk.EmailHaupt] || '').trim() : '',
      vertretung: dk.EmailVertretung != null
                    ? String(dd[i][dk.EmailVertretung] || '').trim() : ''
    });
  }
  return { ok: true, kontakte: kontakte, kunden: kunden };
}

function adminKontakt(d) {
  const was   = String(d.was || '');
  const email = String(d.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) return { ok: false, error: 'keine_mail' };

  const bl  = blatt(T.kontakte);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.Email, email, true);

  if (was === 'neu') {
    if (i >= 0) return { ok: false, error: 'existiert' };
    const name = String(d.name || '').trim();
    if (!name) return { ok: false, error: 'unvollstaendig' };
    // Nach Spaltennamen, nicht nach Position: die Reihenfolge im Blatt darf
    // sich aendern, sagt spalten() — und adminKunde direkt darunter haelt
    // sich auch daran.
    const z = new Array(bl.getLastColumn()).fill('');
    z[k.Name]  = name;
    z[k.Email] = email;
    z[k.Aktiv] = true;
    bl.appendRow(z);
    return adminStamm();
  }
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };
  if (was === 'aus' || was === 'an') {
    bl.getRange(i + 1, k.Aktiv + 1).setValue(was === 'an');
    return adminStamm();
  }
  return { ok: false, error: 'unbekannte Aktion' };
}

function adminKunde(d) {
  const was  = String(d.was || '');
  const name = String(d.name || '').trim();
  if (!name) return { ok: false, error: 'unvollstaendig' };

  const bl  = blatt(T.kunden);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  const i   = zeileFinden(dat, k.Name, name, true);

  if (was === 'neu') {
    if (i >= 0) return { ok: false, error: 'existiert' };
    const z = new Array(bl.getLastColumn()).fill('');
    z[k.Name]  = name;
    z[k.Aktiv] = true;
    // Ans Ende der Sortierung, in Zehnerschritten wie die von Hand
    // gepflegten Zeilen — dazwischen bleibt Platz.
    let hoechste = 0;
    for (let j = 1; j < dat.length; j++) {
      hoechste = Math.max(hoechste, Number(dat[j][k.Sortierung] || 0));
    }
    z[k.Sortierung] = hoechste + 10;
    bl.appendRow(z);
    return adminStamm();
  }
  if (i < 0) return { ok: false, error: 'nicht_gefunden' };

  if (was === 'aus' || was === 'an') {
    bl.getRange(i + 1, k.Aktiv + 1).setValue(was === 'an');
    return adminStamm();
  }
  if (was === 'empfaenger') {
    if (k.EmailHaupt == null) return { ok: false, error: 'spalte_fehlt' };
    const haupt = String(d.haupt || '').trim().toLowerCase();
    const vert  = String(d.vertretung || '').trim().toLowerCase();
    // Leer heisst «keine Vorgabe» und ist erlaubt; was dasteht, muss aber
    // eine Adresse sein — sonst faellt es erst beim Senden auf.
    if (haupt && haupt.indexOf('@') < 0) return { ok: false, error: 'keine_mail' };
    if (vert && vert.indexOf('@') < 0)   return { ok: false, error: 'keine_mail' };
    bl.getRange(i + 1, k.EmailHaupt + 1).setValue(haupt);
    if (k.EmailVertretung != null) {
      bl.getRange(i + 1, k.EmailVertretung + 1).setValue(vert);
    }
    return adminStamm();
  }
  return { ok: false, error: 'unbekannte Aktion' };
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
    // Die Rolle steht in der gemerkten Sitzung. Ohne das Leeren haette der
    // Betroffene bis zu einer Minute lang noch die alten Rechte — und bei
    // «kein_admin» ist das genau die Minute, auf die es ankommt.
    case 'admin':
      bl.getRange(zeile, k.Rolle + 1).setValue('admin');
      sitzungCacheLeeren(email);
      return { ok: true };
    case 'kein_admin':
      bl.getRange(zeile, k.Rolle + 1).setValue('');
      sitzungCacheLeeren(email);
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

/**
 * Die drei Einstellungen, die den Versand steuern. Nur diese drei sind
 * ueber die App erreichbar — alles andere im Blatt «Parameter» ist
 * Datenbestand, keine Einstellung.
 */
const ADMIN_PARAMETER = ['MailAn', 'ArchivOrdner', 'FotoOrdner', 'SicherungOrdner'];

/**
 * Liest die Einstellungen, und schreibt sie, wenn `werte` mitkommt.
 * Zurueck kommt immer der gespeicherte Stand plus der Name des Ordners,
 * den die ID wirklich trifft: eine ID sagt einem Menschen nichts, ein
 * falsch eingefuegter Ordner faellt sonst erst beim ersten Versand auf.
 */
function adminParameter(d, u) {
  if (d.werte && typeof d.werte === 'object') {
    const mail = String(d.werte.MailAn == null ? parameter('MailAn') : d.werte.MailAn).trim();
    if (mail && mail.indexOf('@') < 0) return { ok: false, error: 'mail_ungueltig' };

    ADMIN_PARAMETER.forEach(s => {
      if (d.werte[s] == null) return;
      const wert = s === 'MailAn' ? String(d.werte[s]).trim()
                                  : driveId(d.werte[s]);
      parameterSetzen(s, wert);
    });
  }

  const werte = {}, namen = {};
  ADMIN_PARAMETER.forEach(s => { werte[s] = parameter(s); });
  ADMIN_PARAMETER.forEach(s => {
    if (s !== 'MailAn') namen[s] = ordnerName(werte[s]);
  });
  return { ok: true, werte: werte, ordner: namen };
}

/** Schreibt einen Parameter; legt die Zeile an, wenn es sie noch nicht gibt. */
function parameterSetzen(schluessel, wert) {
  const bl  = blatt(T.parameter);
  const dat = bl.getDataRange().getValues();
  const k   = spalten(dat[0]);
  for (let i = 1; i < dat.length; i++) {
    if (String(dat[i][k.Schluessel]).trim() === schluessel) {
      bl.getRange(i + 1, k.Wert + 1).setValue(wert);
      return;
    }
  }
  const z = new Array(Math.max(bl.getLastColumn(), 2)).fill('');
  z[k.Schluessel] = schluessel;
  z[k.Wert]       = wert;
  bl.appendRow(z);
}

/**
 * Aus einer eingefuegten Adresse die blosse Drive-ID holen. Wer die Tabelle
 * oder den Ordner offen hat, kopiert die Adresse aus der Leiste — nicht den
 * Teil zwischen /d/ und /edit. openById() antwortet darauf mit «Invalid
 * argument: id», und das sagt niemandem, was zu tun ist.
 */
function driveId(wert) {
  const s = String(wert || '').trim();
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : s;
}

/** Name des Ordners zu einer ID, oder leer wenn sie nicht stimmt. */
function ordnerName(id) {
  if (!String(id || '').trim()) return '';
  try {
    return DriveApp.getFolderById(String(id).trim()).getName();
  } catch (e) {
    return '';
  }
}

/**
 * Der Text des Zugangsmails.
 *
 * Der Hinweis auf Safari steht bewusst weit oben und ausfuehrlich: die
 * haeufigste Stolperfalle ist nicht der falsche Browser, sondern der Link
 * im Mail selbst. Viele Mailprogramme oeffnen ihn in einem eigenen Fenster,
 * und dort gibt es «Zum Home-Bildschirm» gar nicht — der Empfaenger kommt
 * bis zur Anmeldung und danach nicht weiter, ohne zu wissen warum.
 */
function zugangText(name, pass) {
  return [
    'Guten Tag ' + name,
    '',
    'Der Wareneingang wird neu direkt am Gerät erfasst.',
    '',
    'Adresse:  ' + eigenschaft('PWA_URL'),
    'Passwort: ' + pass,
    '',
    'WICHTIG: Die Adresse bitte ausschliesslich mit Safari öffnen.',
    '',
    'Tippe den Link nicht hier in der Mail an. Viele Mailprogramme',
    'öffnen ihn in einem eigenen Fenster, und dort lässt sich das Symbol',
    'nicht auf den Home-Bildschirm legen. Stattdessen:',
    '',
    '  1. Die Adresse oben markieren und kopieren',
    '  2. Safari öffnen',
    '  3. Adresse in die Leiste oben einfügen und öffnen',
    '',
    'Jeder Browser merkt sich die Anmeldung für sich. Meldest du dich in',
    'einem anderen Browser an, musst du es in Safari noch einmal tun.',
    '',
    'Beim ersten Mal wählst du ein eigenes Passwort — das zugestellte gilt',
    'nur bis dahin.',
    '',
    'Symbol auf den Home-Bildschirm: in Safari unten auf «Teilen» tippen,',
    'dann «Zum Home-Bildschirm». Danach öffnest du den Wareneingang immer',
    'über dieses Symbol, nicht mehr über den Browser.',
    '',
    'Freundliche Grüsse'
  ].join('\n');
}

/* ============================================================
   11) CSV fuer Excel / Power Query
   ============================================================ */

/**
 * Feste Spalten der CSV-Schnittstelle. Reihenfolge und Anzahl aendern sich
 * NICHT — auf ihnen steht die Excel-Vorlage. Eine neue Spalte im Blatt
 * «Wareneingang» oder «Positionen» kommt hier nicht automatisch an; wer sie
 * braucht, haengt sie hier hinten an, nie dazwischen.
 *
 * Eine Zeile je Position; die Kopfdaten wiederholen sich in jeder Zeile,
 * damit die Vorlage mit einem einzigen VERGLEICH auskommt. Die letzte
 * Spalte «Schluessel» (WeNr-Nr) macht daraus auch fuer die Positionen
 * einen einfachen Nachschlag — siehe EXCEL.md.
 */
const CSV_SPALTEN = [
  'WeNr', 'Kunde', 'Lieferant', 'LagerM2', 'KopfBemerkung',
  'AngNam', 'AngDat', 'AngZeit',
  'GezNam', 'GezDat', 'GezZeit',
  'EinNam', 'EinDat', 'EinZeit',
  'Nr', 'Artikel', 'Anzahl', 'KG', 'MHD', 'Regalplatz', 'Bemerkung', 'Bestehend',
  'Schluessel'
];

/**
 * @param p  Abfrageparameter: `we` schraenkt auf einen Wareneingang ein,
 *           `tage` auf die letzten n Tage. Ohne beides kommt alles,
 *           was nicht zurueckgezogen ist.
 */
function csvExport(p) {
  p = p || {};
  const nurWe = String(p.we || '').trim();
  const tage  = Number(p.tage || 0);
  // AngDat steht als Text yyyy-MM-dd, deshalb genuegt ein Textvergleich.
  const abDatum = tage > 0
    ? fmt(new Date(Date.now() - tage * 86400000), 'yyyy-MM-dd') : '';

  const daten = datenLesen([T.we, T.pos]);
  const wd = daten[T.we];
  const wk = spalten(wd[0]);
  const kopf = {};
  for (let i = 1; i < wd.length; i++) {
    if (String(wd[i][wk.Storniert]).toLowerCase() === 'true') continue;
    const nr = String(wd[i][wk.WeNr]);
    if (nurWe && nr !== nurWe) continue;
    if (abDatum && alsDatum(wd[i][wk.AngDat]) < abDatum) continue;
    kopf[nr] = wd[i];
  }

  const pd = daten[T.pos];
  const pk = spalten(pd[0]);
  const aus = [CSV_SPALTEN.slice()];

  for (let i = 1; i < pd.length; i++) {
    const w = kopf[String(pd[i][pk.WeNr])];
    if (!w) continue;
    aus.push([
      w[wk.WeNr], w[wk.Kunde], w[wk.Lieferant], w[wk.LagerM2], w[wk.Bemerkung],
      w[wk.AngNam], w[wk.AngDat], w[wk.AngZeit],
      w[wk.GezNam], w[wk.GezDat], w[wk.GezZeit],
      w[wk.EinNam], w[wk.EinDat], w[wk.EinZeit],
      pd[i][pk.Nr], pd[i][pk.Artikel], pd[i][pk.Anzahl], pd[i][pk.KG],
      pd[i][pk.MHD], pd[i][pk.Regalplatz], pd[i][pk.Bemerkung],
      String(pd[i][pk.Bestehend]).toLowerCase() === 'true' ? 'X' : '',
      // WeNr-Nr: damit das Formularblatt eine Position mit einem
      // gewoehnlichen INDEX/VERGLEICH findet, statt mit einer
      // Matrixformel ueber zwei Kriterien.
      String(w[wk.WeNr]) + '-' + String(pd[i][pk.Nr])
    ]);
  }

  return aus.map((z, i) => z.map((feld, j) => {
    const s = i === 0 ? String(feld) : feldText(CSV_SPALTEN[j], feld);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}

/* ============================================================
   12) Hilfsmittel
   ============================================================ */

/**
 * Die Tabelle. Eine falsch eingetragene SHEET_ID ist der haeufigste
 * Einrichtungsfehler, und «Invalid argument: id» sagt nicht, welche der
 * Eigenschaften gemeint ist oder was drinsteht — hier steht beides.
 */
function tabelle() {
  const id = driveId(eigenschaft('SHEET_ID'));
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Tabelle nicht erreichbar. SHEET_ID ergab «' + id + '»: ' +
                    e.message + '. In den Skripteigenschaften gehoert der ' +
                    'Teil der Tabellen-URL zwischen /d/ und /edit — die ganze ' +
                    'Adresse tut es auch.');
  }
}

function blatt(name) {
  const bl = tabelle().getSheetByName(name);
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

/**
 * Passwort-Hash. Ein einzelner SHA-256-Durchgang ist so schnell, dass eine
 * abhanden gekommene Zeile aus «Benutzer» praktisch so gut ist wie das
 * Passwort selbst. Wiederholtes Hashen verteuert das Durchprobieren um den
 * Faktor der Rundenzahl, kostet beim Anmelden aber nur einmal Bruchteile
 * einer Sekunde — Anmelden geschieht je Geraet einmal im Monat.
 *
 * Die Marke am Anfang sagt, nach welchem Verfahren gerechnet wurde. Ohne sie
 * ist es die alte Fassung; hashPasst() nimmt beide an, und login() ersetzt
 * die alte beim naechsten erfolgreichen Anmelden. So sperrt diese Aenderung
 * niemanden aus.
 */
const HASH_MARKE  = 'v2$';
const HASH_RUNDEN = 1000;

function hash(pass, salt) {
  let wert = salt + pass;
  for (let i = 0; i < HASH_RUNDEN; i++) wert = digest(wert);
  return HASH_MARKE + wert;
}

function digest(text) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
  );
}

/** Prueft gegen beide Fassungen. */
function hashPasst(pass, salt, soll) {
  const s = String(soll || '');
  if (!salt || !s) return false;
  if (s.indexOf(HASH_MARKE) === 0) return hash(pass, salt) === s;
  return digest(String(salt) + pass) === s;
}

/**
 * Zufall fuer Sitzungstoken, Passwoerter und Salz.
 *
 * NICHT Math.random(): das ist ein vorhersagbarer Generator, und wer einen
 * eigenen Sitzungstoken bekommt, hat 32 seiner Ausgaben in der Hand — daraus
 * laesst sich der Zustand rekonstruieren und der naechste Token berechnen.
 * Utilities.getUuid() zieht aus dem sicheren Zufall der Laufzeit.
 *
 * Das Alphabet laesst 0/O und 1/l/I weg, weil Passwoerter vorgelesen und
 * abgetippt werden. 224 ist 4*56: Bytes darueber werden verworfen, sonst
 * waeren die ersten 32 Zeichen des Alphabets haeufiger als die letzten.
 */
function zufall(n) {
  const z = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let aus = '';
  while (aus.length < n) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i + 1 < hex.length && aus.length < n; i += 2) {
      const b = parseInt(hex.substr(i, 2), 16);
      if (b < 224) aus += z.charAt(b % z.length);
    }
  }
  return aus;
}

/** «3,4» und «3.4» ergeben beide 3.4; alles andere wird leer. */
function zahl(wert) {
  if (wert === '' || wert == null) return '';
  const n = parseFloat(String(wert).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

/** Spaltennamen eines Blattes, ohne die ganze Tabelle dafuer zu lesen. */
function kopfSpalten(bl) {
  return spalten(bl.getRange(1, 1, 1, bl.getLastColumn()).getValues()[0]);
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
  const ss = tabelle();
  const plan = {};
  plan[T.we] = ['WeNr', 'Zeitstempel', 'Erfasser', 'Email', 'Kunde', 'Lieferant',
                'AngNam', 'AngDat', 'AngZeit', 'GezNam', 'GezDat', 'GezZeit',
                'EinNam', 'EinDat', 'EinZeit', 'LagerM2', 'Bemerkung',
                'Storniert', 'Status', 'FotoUrl', 'DateiUrl', 'Gesendet',
                'Vorgang'];
  plan[T.pos] = ['WeNr', 'Nr', 'Artikel', 'Anzahl', 'KG', 'MHD',
                 'Regalplatz', 'Bemerkung', 'Bestehend', 'FotoUrl'];
  plan[T.kunden]      = ['Name', 'Aktiv', 'Sortierung',
                         'EmailHaupt', 'EmailVertretung'];
  plan[T.kontakte]    = ['Name', 'Email', 'Aktiv'];
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
      return;
    }
    // Bestehende Tabelle: fehlende Spalten hinten anhaengen. Damit zieht eine
    // laufende Installation eine neue Version nach, ohne dass jemand
    // Kopfzeilen abtippt — und hinten, nie dazwischen, weil die CSV-
    // Schnittstelle auf der Reihenfolge steht.
    const kopf  = bl.getRange(1, 1, 1, bl.getLastColumn()).getValues()[0]
                    .map(x => String(x || '').trim());
    const fehlt = plan[name].filter(s => kopf.indexOf(s) < 0);
    if (fehlt.length) {
      bl.getRange(1, kopf.length + 1, 1, fehlt.length).setValues([fehlt])
        .setFontWeight('bold');
    }
  });

  // Datum UND Uhrzeit als Text. Sheets liest einen geschriebenen String wie
  // eine Tastatureingabe: «2026-09-09» wird zum Datum, «08:30» zur Uhrzeit,
  // und beides kommt danach als Zeitstempel zurueck — in die Liste, in die
  // CSV und damit ins Excel-Formular, wo dann «Sat Dec 30 1899 ...» steht.
  textSpalten(ss, T.we, ['AngDat', 'AngZeit', 'GezDat', 'GezZeit',
                         'EinDat', 'EinZeit',
                         'Zeitstempel', 'Gesendet']);
  textSpalten(ss, T.pos, ['MHD']);

  const par = ss.getSheetByName(T.parameter);
  if (par.getLastRow() < 2) {
    par.getRange(2, 1, 4, 2).setValues([
      ['MailAn', ''],          // Adresse, die das fertige Formular erhaelt
      ['ArchivOrdner', ''],    // Drive-Ordner-ID fuer die xlsx-Ablage
      ['FotoOrdner', ''],      // Drive-Ordner-ID fuer Lieferschein-Fotos
      ['SicherungOrdner', '']  // eigener Ordner: die Kopie enthaelt Hashes
    ]);
  }

  // Die Ablage gleich mit: sonst muesste jemand drei Ordner von Hand
  // anlegen und ihre IDs aus der Adressleiste abschreiben.
  const ordner = ordnerAnlegen();

  return 'fertig\n' + ordner;
}

/**
 * Formatiert Spalten als Text — nach Namen und ueber die ganze Hoehe des
 * Blattes. Beides mit Absicht: eine feste Spaltennummer bricht, sobald
 * jemand die Reihenfolge aendert (was diese Tabelle ausdruecklich erlaubt),
 * und eine Grenze bei Zeile n faellt genau dann auf, wenn niemand mehr an
 * sie denkt. Angehaengte Zeilen erben das Format der letzten.
 *
 * Laeuft mehrfach ohne Schaden — bei einer bestehenden Tabelle einmal
 * `setupAnlegen` nachziehen.
 */
function textSpalten(ss, blattName, namen) {
  const bl = ss.getSheetByName(blattName);
  const k  = spalten(bl.getRange(1, 1, 1, bl.getLastColumn()).getValues()[0]);
  namen.forEach(name => {
    if (k[name] == null) return;
    bl.getRange(2, k[name] + 1, bl.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

/**
 * Sagt, wie es um die Einrichtung steht: welche Eigenschaft fehlt, ob sich
 * die Tabelle oeffnen laesst, welche Blaetter da sind und wie die CSV-Adresse
 * fuer die Excel-Vorlage lautet. Im Editor ausfuehren und ins Protokoll sehen.
 */
function einrichtungPruefen() {
  eigenschaft._alle = null;                       // frisch lesen, nicht aus dem Cache
  const zeilen = [];

  ['SHEET_ID', 'PWA_URL', 'TOKEN_READ'].forEach(name => {
    const wert = eigenschaft(name, true);
    zeilen.push(name + ': ' + (wert || 'FEHLT'));
    // Steht dort die ganze Adresse, ist das in Ordnung — aber sichtbar
    // machen, womit wirklich gearbeitet wird.
    if (name === 'SHEET_ID' && wert && driveId(wert) !== wert) {
      zeilen.push('  daraus die ID: ' + driveId(wert));
    }
  });

  try {
    const ss = tabelle();
    zeilen.push('Tabelle: ' + ss.getName());
    const fehlt = Object.keys(T).map(s => T[s]).filter(n => !ss.getSheetByName(n));
    // Die Zahl nicht ausschreiben: sie hat sich schon geaendert, und ein
    // Bericht, der «alle sieben» sagt, waehrend es acht sind, ist schlimmer
    // als einer ohne Zahl.
    zeilen.push(fehlt.length ? 'Blaetter FEHLEN: ' + fehlt.join(', ') + ' — setupAnlegen()'
                             : 'Blaetter: alle ' + Object.keys(T).length + ' da');
  } catch (e) {
    zeilen.push('Tabelle: ' + e.message);
  }

  ORDNER_PLAN.forEach(o => {
    const id = parameter(o.par);
    zeilen.push(o.par + ': ' + (id ? (ordnerName(id) || 'ID nicht erreichbar')
                                   : 'leer — abgeschaltet'));
  });
  zeilen.push('MailAn: ' + (parameter('MailAn') || 'FEHLT — Versand meldet einen Fehler'));

  const token = eigenschaft('TOKEN_READ', true);
  if (token) {
    zeilen.push('CSV fuer die Vorlage: <Web-App-URL>?token=' + token +
                '&format=csv&tage=365');
  }

  const text = zeilen.join('\n');
  console.log(text);
  return text;
}

/* ------------------------------------------------------------------
   Der naechste Schritt, und warum er noch nicht getan ist

   Gemessen wird der Weg zum Server als das Teure — dagegen half, aus drei
   Aufrufen einen zu machen. Was im Skript selbst noch liegt, sind zwei
   Posten: das Oeffnen der Tabelle (`openById`, einmal je Ausfuehrung) und
   das Lesen der Blaetter, eines nach dem anderen.

   `Sheets.Spreadsheets.Values.batchGet` holt alle Bereiche in EINER
   Anfrage und oeffnet dabei gar nichts. In einem gleich gebauten Projekt
   waren das 150 ms statt 1086 — aber ob es HIER, auf diesen Daten, ebenso
   ausgeht, ist eine Frage an Zahlen und nicht an Ueberlegung. In diesem
   Projekt hat die Ueberlegung sich schon einmal geirrt: die Vermutung,
   `openById` koste innerhalb einer Ausfuehrung jedes Mal, war falsch.

   Beide Messungen sind gelaufen und haben dafuer gesprochen: 1948 ms
   gegen 209, und «Positionen» ohne einen einzigen Unterschied. Der Umbau
   IST getan — datenLesen() liest ueber batchGet, sobald der erweiterte
   Dienst da ist, und der README sagt jeder Installation, ihn
   einzuschalten. «Sessions» und «Benutzer» blieben aussen vor, weil an
   ihnen die Datumsvergleiche haengen.

   Die beiden Funktionen bleiben stehen, aber fuer das Danach: nach jeder
   Aenderung an CSV_SPALTEN oder am Tabellenaufbau sagt treueVergleichen(),
   ob beide Wege noch dasselbe liefern.

   Beide brauchen den erweiterten Dienst: im Editor links **Dienste +**,
   dann **Google Sheets API** hinzufuegen (Kennung `Sheets`).
   ------------------------------------------------------------------ */

/** Die Blaetter, die ein «start» liest. */
const MESS_BLAETTER = [T.sessions, T.benutzer, T.we, T.pos, T.kunden, T.lieferanten];

/**
 * Liest dieselben Blaetter auf beiden Wegen und stellt die Zeiten
 * nebeneinander — fuenf Runden je Weg, mit min, Median, max und den rohen
 * Werten. Die rohen Werte, weil in dieser Sache die Streuung die
 * eigentliche Geschichte ist: ein Median sagt nichts ueber den Lauf, an
 * den sich der Benutzer erinnert.
 */
function geschwindigkeitMessen() {
  const zeilen = [];
  const runden = 5;

  if (typeof Sheets === 'undefined') {
    return protokoll(['Der erweiterte Dienst fehlt.',
                      'Editor → Dienste + → Google Sheets API hinzufuegen.',
                      'Ohne ihn ist hier nichts zu messen.']);
  }

  // Das Oeffnen NUR EINMAL messen. Dieselbe Tabelle ein zweites Mal in
  // derselben Ausfuehrung zu oeffnen bedient die Plattform aus ihrem
  // eigenen Cache — die zweite Messung waere die des Caches, nicht die,
  // die ein Aufruf zahlt.
  const tOffen = Date.now();
  const ss = tabelle();
  zeilen.push('Tabelle oeffnen (nur eine Probe): ' + (Date.now() - tOffen) + ' ms');

  // Erst warmlaufen. Eine kalte Laufzeit als Dauerzustand zu melden ist
  // der Fehler, der in diesem Projekt schon einmal gemacht wurde.
  MESS_BLAETTER.forEach(n => ss.getSheetByName(n).getDataRange().getValues());
  batchLesen(MESS_BLAETTER);

  const alt = [], neu = [];
  for (let i = 0; i < runden; i++) {
    let t = Date.now();
    MESS_BLAETTER.forEach(n => ss.getSheetByName(n).getDataRange().getValues());
    alt.push(Date.now() - t);

    t = Date.now();
    batchLesen(MESS_BLAETTER);
    neu.push(Date.now() - t);
  }

  zeilen.push('');
  zeilen.push('SpreadsheetApp, ' + MESS_BLAETTER.length + ' Lesevorgaenge');
  zeilen.push('  ' + spanne(alt));
  zeilen.push('Sheets batchGet, eine Anfrage');
  zeilen.push('  ' + spanne(neu));
  zeilen.push('');
  zeilen.push('Dagegen zu wiegen: der Weg zum Server kostet je Aufruf ein');
  zeilen.push('Vielfaches davon. Lohnt sich der Umbau erst ab einer halben');
  zeilen.push('Sekunde Unterschied, sagt das hier, ob er sich lohnt.');
  return protokoll(zeilen);
}

function spanne(werte) {
  const s = werte.slice().sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2]
                           : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  return 'min ' + s[0] + '  Median ' + med + '  max ' + s[s.length - 1] +
         '  — ' + werte.join(', ');
}

/**
 * Liest mehrere Blaetter in EINER Anfrage.
 *
 * Drei Dinge, an denen das still falsch werden koennte:
 *
 * 1. `batchGet` liefert ohne Weiteres den ANGEZEIGTEN Text. Aus `true`
 *    wuerde die Zeichenkette «TRUE», und `=== true` faende sie nie —
 *    stornierte Zeilen kaemen zurueck, inaktive Kunden auch.
 *    `UNFORMATTED_VALUE` verhindert das.
 * 2. `batchGet` hoert bei der letzten gefuellten Zelle auf. Eine Zeile,
 *    deren letzte Spalten leer sind, kommt KUERZER zurueck — und weil
 *    ueberall nach Spaltenindex zugegriffen wird, stuende dort
 *    `undefined` statt `''`. Hier wird aufgefuellt.
 * 3. Die Ergebnisse werden ueber den Bereich zugeordnet, den jedes selbst
 *    nennt, nicht ueber ihre Reihenfolge. Auf die Reihenfolge zu setzen
 *    hiesse, an dem Tag `Benutzer` fuer `Wareneingang` zu halten, an dem
 *    sie einmal nicht stimmt — und nichts saehe falsch aus.
 */
function batchLesen(namen) {
  const antwort = Sheets.Spreadsheets.Values.batchGet(driveId(eigenschaft('SHEET_ID')), {
    ranges: namen.map(n => "'" + n.replace(/'/g, "''") + "'"),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });

  const aus = {};
  // Gezaehlt, weil sonst niemand merkt, ob das Auffuellen ueberhaupt je
  // etwas zu tun hatte — und ein Auffuellen, das nie greift, faellt beim
  // naechsten Umbau heraus. Nach dem Auffuellen ist der Fall nicht mehr
  // zu sehen, also hier.
  batchLesen.kurz = 0;
  (antwort.valueRanges || []).forEach(vr => {
    const name = String(vr.range || '').split('!')[0].replace(/^'|'$/g, '').replace(/''/g, "'");
    const werte = vr.values || [];
    // reduce statt Math.max(...): ein Argument je Zeile sprengt bei
    // hunderttausend Zeilen den Aufrufstapel, und der Wurf faellt in den
    // catch von datenLesen — die Optimierung waere dann still wieder weg.
    const breit = werte.reduce((m, z) => (z.length > m ? z.length : m), 0);
    aus[name] = werte.map(z => {
      if (z.length < breit) batchLesen.kurz++;
      const voll = z.slice();
      while (voll.length < breit) voll.push('');
      return voll;
    });
  });
  return aus;
}

/**
 * Vergleicht Zelle fuer Zelle, was die beiden Wege liefern — nach Wert
 * UND nach Typ, und meldet jeden Unterschied mit Blatt, Zeile und
 * Spaltennamen.
 *
 * Die Gefahr ist hier eine andere als in anderen Projekten: `AngDat`,
 * `AngZeit` und `MHD` stehen als TEXT in der Tabelle, damit Sheets aus
 * «08:30» keine Uhrzeit macht. Was `batchGet` daraus macht, entscheidet,
 * ob im Excel-Formular wieder «Sat Dec 30 1899» steht. Das steht hier
 * nicht zur Vermutung, sondern wird an der lebenden Tabelle nachgesehen.
 */
function treueVergleichen() {
  if (typeof Sheets === 'undefined') {
    return protokoll(['Der erweiterte Dienst fehlt.',
                      'Editor → Dienste + → Google Sheets API hinzufuegen.']);
  }

  const ss = tabelle();
  const zeilen = [];
  let zellen = 0, abweichung = 0;
  const neu = batchLesen(MESS_BLAETTER);
  const kurz = batchLesen.kurz;

  MESS_BLAETTER.forEach(name => {
    const a = ss.getSheetByName(name).getDataRange().getValues();
    const b = neu[name] || [];
    const kopf = a.length ? a[0].map(x => String(x || '')) : [];

    if (a.length !== b.length) {
      zeilen.push(name + ': ' + a.length + ' Zeilen bisher, ' + b.length + ' ueber batchGet');
      abweichung++;
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      for (let j = 0; j < a[i].length; j++) {
        zellen++;
        const x = a[i][j], y = j < b[i].length ? b[i][j] : undefined;
        const gleich = (x instanceof Date && y instanceof Date)
          ? x.getTime() === y.getTime()
          : (x === y && typeof x === typeof y);
        if (gleich) continue;
        abweichung++;
        if (abweichung <= 20) {
          zeilen.push(name + ' Zeile ' + (i + 1) + ' Spalte «' +
                      (kopf[j] || (j + 1)) + '»: bisher ' + typBeschreibung(x) +
                      ', batchGet ' + typBeschreibung(y));
        }
      }
    }
  });

  zeilen.unshift('');
  zeilen.unshift(zellen + ' Zellen verglichen, ' + abweichung + ' Unterschiede, ' +
                 kurz + ' zu kurz zurueckgegebene Zeilen');
  if (abweichung > 20) zeilen.push('… und ' + (abweichung - 20) + ' weitere');
  zeilen.push('');
  zeilen.push(abweichung
    ? 'Jeder dieser Unterschiede waere beim Umbau still kaputtgegangen.'
    : 'Kein Unterschied — der Umbau des Lesewegs waere von hier aus sicher.');
  if (kurz) {
    zeilen.push('Kurze Zeilen kommen vor: batchLesen() fuellt sie auf, und das');
    zeilen.push('muss es auch weiterhin tun.');
  }
  return protokoll(zeilen);
}

function typBeschreibung(w) {
  if (w === undefined) return 'nichts (Zeile war kuerzer)';
  if (w instanceof Date) return 'Date ' + fmt(w, 'yyyy-MM-dd HH:mm');
  return typeof w + ' ' + JSON.stringify(w);
}

function protokoll(zeilen) {
  const text = zeilen.join('\n');
  console.log(text);
  return text;
}

/**
 * Legt ein starkes TOKEN_READ in den Skripteigenschaften ab und gibt es
 * einmal zurueck. Der Wert gehoert von dort in das Makro
 * `Vorlage-Aufbau.bas` — nicht in den Code und nicht ins Repo.
 */
function tokenErzeugen() {
  const token = zufall(24);
  PropertiesService.getScriptProperties().setProperty('TOKEN_READ', token);
  eigenschaft._alle = null;
  console.log('TOKEN_READ: ' + token);
  return token;
}

/**
 * Die drei Ablageordner. Sie entstehen neben der Tabelle — im selben Ordner,
 * in dem auch das Skript liegt — damit alles zu diesem Wareneingang an einer
 * Stelle steht und niemand IDs aus Adressleisten kopieren muss.
 *
 * «Sicherung» ist bewusst ein eigener Ordner: die Kopie enthaelt das Blatt
 * «Benutzer» mit PassHash und Salt, waehrend «Excel» mit der Buchhaltung
 * geteilt wird.
 */
const ORDNER_PLAN = [
  { par: 'ArchivOrdner',    name: 'Excel' },
  { par: 'FotoOrdner',      name: 'Lieferscheine' },
  { par: 'SicherungOrdner', name: 'Sicherung' }
];

/**
 * Legt die Ordner an und traegt sie ein — aber nur dort, wo noch nichts
 * steht. Ein leeres Feld heisst in der Verwaltung «abgeschaltet»; wer den
 * Fotoordner absichtlich leer laesst, bekommt ihn hier nicht zurueck.
 * Deshalb nur beim Einrichten, nicht aus der Oberflaeche heraus.
 */
function ordnerAnlegen() {
  const eltern = elternOrdner();
  if (!eltern) return 'kein Ordner neben der Tabelle gefunden';

  return ORDNER_PLAN.map(o => {
    if (parameter(o.par)) return o.par + ': bleibt, wie eingetragen';
    const ordner = unterordner(eltern, o.name);
    parameterSetzen(o.par, ordner.getId());
    return o.par + ' → ' + eltern.getName() + '/' + o.name;
  }).join('\n');
}

/** Der Ordner, in dem die Tabelle liegt. */
function elternOrdner() {
  const eltern = DriveApp.getFileById(driveId(eigenschaft('SHEET_ID'))).getParents();
  return eltern.hasNext() ? eltern.next() : null;
}

/**
 * Haengt die woechentliche Sicherung an einen Zeit-Trigger. Ein zweiter
 * Aufruf legt keinen zweiten an — sonst liefe sie doppelt und der Ordner
 * fuellte sich mit Kopien derselben Nacht.
 */
function sicherungPlanen() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sicherung') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sicherung').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  return 'Sicherung laeuft ab jetzt sonntags gegen 3 Uhr';
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

/**
 * Woechentliche Sicherung — an einen Zeit-Trigger haengen.
 *
 * Eigener Ordner, nicht der Archivordner: die Kopie enthaelt das Blatt
 * «Benutzer» mit PassHash und Salt. Der Archivordner wird mit der
 * Buchhaltung geteilt, dieser hier gehoert mit niemandem geteilt.
 */
function sicherung() {
  const wurzel = String(parameter('SicherungOrdner') || '').trim();
  if (!wurzel) return 'kein SicherungOrdner gesetzt — nichts gesichert';
  DriveApp.getFileById(driveId(eigenschaft('SHEET_ID'))).makeCopy(
    'Wareneingang ' + fmt(new Date(), 'yyyy-MM-dd'),
    DriveApp.getFolderById(wurzel));
  return 'gesichert';
}
