import { createRequire } from 'node:module';
import fs from 'node:fs';

// Playwright wird nicht mitgeliefert. createRequire findet sowohl eine
// lokale als auch eine globale Installation (NODE_PATH), ohne dass das
// Repo ein package.json oder einen Bauschritt braucht.
const { chromium } = createRequire(import.meta.url)('playwright');

const APP = 'file://' + process.cwd() + '/index.html';
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else   { fail++; console.log('  FAIL  ' + n + (extra ? '\n        ' + extra : '')); }
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });

// --- Apps Script nachbilden -------------------------------------------------
// Benannt, nicht inline: eine zweite Seite braucht dieselbe Attrappe, und
// zwei Abschriften laufen frueher oder spaeter auseinander.
const attrappe = () => {
  window.__gesendet = [];
  window.__methoden = [];
  window.__gleichzeitig = 0;      // gerade unterwegs
  window.__hoechstens = 0;        // hoechster je erreichter Stand
  // Der Server vergisst beim Neuladen der Seite nichts — die Attrappe darf
  // es auch nicht, sonst prueft «was steht nach einem Reload da» nichts.
  // sessionStorage, nicht localStorage: Abmelden raeumt localStorage aus.
  const DB = JSON.parse(sessionStorage.getItem('__db') || 'null') ||
             { kopf: null, positionen: [] };
  const merken = () => {
    try { sessionStorage.setItem('__db', JSON.stringify(DB)); } catch (e) {}
  };
  // Der weiteste quittierte Schritt, wie statusAus() im Backend.
  const status = () => DB.ein ? 'eingelagert' : DB.gez ? 'gezaehlt'
                             : DB.ang ? 'angenommen' : 'erfasst';

  window.fetch = async (url, opt) => {
    let d;
    if (opt && opt.body) d = JSON.parse(opt.body);
    else d = Object.fromEntries(new URL('http://x/' + url.replace(/^[^?]*/, '')).searchParams);
    window.__gesendet.push(d);
    window.__methoden.push(opt && opt.method ? opt.method : 'GET');
    window.__gleichzeitig++;
    window.__hoechstens = Math.max(window.__hoechstens, window.__gleichzeitig);
    // Eine Antwort dauert. Einstellbar, damit sich pruefen laesst, was auf
    // dem Schirm steht, WAEHREND sie unterwegs ist.
    await new Promise(r => setTimeout(r, window.__langsam || 5));
    window.__gleichzeitig--;

    const A = o => {
      merken();
      return { text: async () => JSON.stringify(o), json: async () => o, status: 200 };
    };

    // Wie im Code.gs: die Liste steht an einer Stelle, und «start» und
    // «we_liste» geben dieselbe zurueck. Eine Attrappe, in der die beiden
    // auseinanderlaufen koennen, prueft nichts mehr.
    const liste = () => {
      const eigen = DB.kopf ? [{
        weNr: 'WE-2026-0001', datum: '2026-09-09', zeit: '08:30',
        kunde: DB.kopf.kunde, lieferant: DB.kopf.lieferant,
        status: DB.status || 'angenommen', erfasser: 'Anna Muster',
        gesendet: '' }] : [];
      // Ein alter, abgeschlossener Eintrag eines Kollegen: ohne Suche
      // taucht er nicht auf, mit Suche schon.
      const fremd = { weNr: 'WE-2026-0009', datum: '2026-09-01', zeit: '07:15',
        kunde: 'Alte Kunde AG', lieferant: 'Nordwind Logistik',
        status: 'eingelagert', erfasser: 'Bob Meier',
        gesendet: '2026-09-01 08:00' };
      const s = String(d.suche || '').toLowerCase();
      // Ohne Suche: die Arbeitsliste, es sei denn «alle» ist gesetzt. Wer
      // das darf, entscheidet im echten Code.gs die Rolle aus der Sitzung.
      if (!s) return d.alle ? eigen.concat([fremd]) : eigen;
      const passt = x => (x.weNr + ' ' + x.kunde + ' ' + x.lieferant + ' ' +
                          x.erfasser).toLowerCase().includes(s);
      return eigen.concat([fremd]).filter(passt);
    };
    const stamm = { kunden: ['Kunde AG'], lieferanten: ['Lieferant GmbH'] };
    const startDaten = () => ({ ok: true, liste: liste(),
                                kunden: stamm.kunden, lieferanten: stamm.lieferanten });

    switch (d.action) {
      case 'login':
        // Der Server gibt die Startdaten mit — sonst folgte auf das
        // Anmelden sofort ein zweiter Weg fuer genau diese Zeilen.
        {
          const rolle = window.__nichtAdmin ? '' : 'admin';
          return A(window.__ohneStart
            ? { ok: true, session: 'tok', name: 'Anna Muster',
                rolle: rolle, pwGeaendert: true }
            : { ok: true, session: 'tok', name: 'Anna Muster',
                rolle: rolle, pwGeaendert: true, start: startDaten() });
        }
      case 'start':
        // Eine aeltere Bereitstellung kennt die Aktion nicht.
        if (window.__ohneStart) return A({ ok: false, error: 'unbekannte Aktion' });
        return A(startDaten());
      case 'stammdaten':
        return A({ ok: true, kunden: stamm.kunden, lieferanten: stamm.lieferanten });
      case 'we_liste':
        return A({ ok: true, liste: liste() });
      case 'we_speichern': {
        DB.vorgaenge = DB.vorgaenge || {};
        if (d.vorgang && DB.vorgaenge[d.vorgang]) {
          return A({ ok: true, weNr: DB.vorgaenge[d.vorgang], wiederholt: true });
        }
        DB.vorgaenge[d.vorgang] = 'WE-2026-0001';
        DB.kopf = d;
        DB.positionen = d.positionen.map((p, i) =>
          Object.assign({ nr: i + 1, regalplatz: '' }, p, { foto: !!p.bild }));
        const s = d.schritte || [];
        DB.ang = s.includes('angenommen')  ? 'Anna Muster' : '';
        DB.gez = s.includes('gezaehlt')    ? 'Anna Muster' : '';
        DB.ein = s.includes('eingelagert') ? 'Anna Muster' : '';
        DB.status = status();
        return A({ ok: true, weNr: 'WE-2026-0001' });
      }
      case 'we_foto':
        window.__fotoAbrufe = (window.__fotoAbrufe || 0) + 1;
        return A(window.__mitFoto
          ? { ok: true, bild: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }
          : { ok: false, error: 'kein_foto' });
      case 'we_detail':
        return A({ ok: true, positionen: DB.positionen, kopf: {
          // Das angefragte Dokument, nicht immer dasselbe: sonst faellt
          // nie auf, wenn der Schirm ein anderes zeigt, als er geladen hat.
          WeNr: d.weNr || 'WE-2026-0001',
          Kunde: DB.kopf.kunde, Lieferant: DB.kopf.lieferant,
          LagerM2: String(DB.kopf.lagerM2), Bemerkung: DB.kopf.bemerkung,
          AngNam: DB.ang || '', AngDat: DB.ang ? '2026-09-09' : '',
          AngZeit: DB.ang ? '08:30' : '',
          GezNam: DB.gez || '', GezDat: DB.gez ? '2026-09-09' : '', GezZeit: DB.gez ? '09:00' : '',
          EinNam: DB.ein || '', EinDat: '', EinZeit: '',
          FotoUrl: window.__mitFoto ? 'https://drive/x' : '',
          Gesendet: '', Storniert: 'false', Status: DB.status } });
      case 'we_schritt':
        if (d.schritt === 'angenommen')  { DB.ang = 'Anna Muster'; }
        if (d.schritt === 'gezaehlt')    { DB.gez = 'Anna Muster'; }
        if (d.schritt === 'eingelagert') { DB.ein = 'Anna Muster';
          (d.regalplaetze || []).forEach((w, i) => { if (DB.positionen[i]) DB.positionen[i].regalplatz = w; });
          (d.bilder || []).forEach((b, i) => {
            if (b && DB.positionen[i] && !DB.positionen[i].foto) DB.positionen[i].foto = true; }); }
        DB.status = status();
        return A({ ok: true });
      case 'we_senden':
        return A({ ok: true, an: 'lager@firma.ch', url: '' });
      case 'admin_parameter':
        if (d.werte) DB.par = d.werte;
        return A({ ok: true,
          werte: DB.par || { MailAn: 'lager@firma.ch', ArchivOrdner: '1Arch',
                             FotoOrdner: '', SicherungOrdner: '' },
          ordner: { ArchivOrdner: 'Wareneingang Archiv', FotoOrdner: '',
                    SicherungOrdner: '' } });
      case 'admin_liste':
        return A({ ok: true, benutzer: [{ email: 'anna@firma.ch', name: 'Anna Muster',
          aktiv: true, admin: true, neu: false, gesperrt: false }] });
      case 'admin_neu':
        return A({ ok: true, passwort: 'Xy7k9m2Qw4', text: 'Guten Tag …',
                   wem: d.name + ' <' + d.email + '>' });
      default:
        return A({ ok: true });
    }
  };
};
await page.addInitScript(attrappe);

const sichtbar = id => page.$eval(id, e => e.classList.contains('aktiv'));
const feld = async (i, f, wert) =>
  page.fill(`.pos[data-i="${i}"] [data-f="${f}"]`, wert);

// --- 1) Anmeldung -----------------------------------------------------------
await page.goto(APP);
console.log('\n1) Anmeldung');
ok('Loginscreen zuerst', await sichtbar('#scr-login'));
await page.fill('#lg-email', 'anna@firma.ch');
await page.fill('#lg-pass', 'geheim123');
await page.click('#lg-senden');
await page.waitForSelector('#scr-start.aktiv');
ok('nach Login auf der Uebersicht', await sichtbar('#scr-start'));
ok('Name im Kopf', (await page.textContent('#st-name')) === 'Anna Muster');
// Apps Script ist mit zwei gleichzeitigen Aufrufen desselben Skripts nicht
// zuverlaessig; der zweite kann eine Fehlerseite statt JSON zurueckgeben.
ok('Aufrufe gehen nacheinander',
   (await page.evaluate(() => window.__hoechstens)) === 1,
   'hoechstens ' + (await page.evaluate(() => window.__hoechstens)) + ' gleichzeitig');
ok('Adminknopf sichtbar fuer Admin', !(await page.$eval('#st-admin', e => e.hidden)));

// Anmelden ist EIN Weg zum Server. Vorher waren es drei — login, we_liste,
// stammdaten — und jeder einzelne schleppt die Weiterleitung von /exec, die
// Antwort von einem zweiten Host und moeglicherweise einen kalten
// Skriptstart mit sich. Das war der groesste Teil der Wartezeit.
const nachLogin = await page.evaluate(() => window.__gesendet.map(x => x.action));
ok('Anmelden braucht einen einzigen Aufruf',
   nachLogin.length === 1 && nachLogin[0] === 'login', nachLogin.join(','));
ok('und bringt die Stammdaten gleich mit',
   (await page.$$('#dl-kunden option')).length === 1 &&
   (await page.$$('#dl-lieferanten option')).length === 1);
ok('und die Uebersicht wartet nicht mehr',
   !(await page.textContent('#st-liste')).includes('Wird geladen'),
   await page.textContent('#st-liste'));

// --- 2) Formular ------------------------------------------------------------
console.log('\n2) Formular');
await page.click('#st-neu');
await page.waitForSelector('#scr-form.aktiv');
ok('5 Leerzeilen wie auf dem Papier', (await page.$$('.pos')).length === 5);
ok('Regalplatzfeld je Position',
   (await page.$$('.pos [data-f="regalplatz"]')).length === 5);
ok('Angenommen vorausgewaehlt', await page.isChecked('#fm-s-angenommen'));
// Der Text ist geaendert worden; drei Pruefungen halten ihn fest, damit er
// bei der naechsten Umformulierung nicht still zurueckfaellt.
ok('quittiert wird auf den eigenen Namen, geduzt',
   (await page.textContent('#scr-form')).includes('auf deinen Namen'));
ok('der Hinweis duzt ebenfalls',
   (await page.textContent('#scr-form')).includes('was du selbst erledigt hast'));
// Leerraum zusammenziehen: im Quelltext bricht der Satz um, auf dem Schirm
// nicht — sonst pruefte das hier die Zeilenlaenge statt den Text.
ok('und nennt, wer spaeter quittiert',
   (await page.textContent('#scr-form')).replace(/\s+/g, ' ')
     .includes('von der Person, die es ausgeführt hat, quittiert'));
ok('Gezaehlt nicht vorausgewaehlt', !(await page.isChecked('#fm-s-gezaehlt')));
ok('Eingelagert nicht vorausgewaehlt', !(await page.isChecked('#fm-s-eingelagert')));

await feld(0, 'artikel', 'Schrauben M6');
await feld(0, 'anzahl', '120');
await feld(0, 'kg', '3,4');                       // Komma statt Punkt
await feld(0, 'mhd', '10.2027');
await feld(0, 'regalplatz', 'A-12');
await page.check('.pos[data-i="0"] [data-f="bestehend"]');
await feld(1, 'artikel', 'ZWEITE — wird entfernt');
await feld(2, 'artikel', 'Kartonage 60x40');
await feld(2, 'anzahl', '8');

ok('Zaehler zeigt ausgefuellte Zeilen', (await page.textContent('#fm-poszahl')) === '3 ausgefüllt');

// --- 3) Zeile entfernen, Werte muessen stehen bleiben -----------------------
console.log('\n3) Zeile entfernen');
await page.click('.pos-weg[data-i="1"]');
ok('eine Karte weniger', (await page.$$('.pos')).length === 4);
ok('Zeile 1 unveraendert',
   (await page.inputValue('.pos[data-i="0"] [data-f="artikel"]')) === 'Schrauben M6');
ok('Haken bleibt gesetzt',
   await page.isChecked('.pos[data-i="0"] [data-f="bestehend"]'));
ok('Zeile 3 nachgerueckt, Wert erhalten',
   (await page.inputValue('.pos[data-i="1"] [data-f="artikel"]')) === 'Kartonage 60x40');
ok('Nummerierung neu vergeben',
   (await page.textContent('.pos[data-i="1"] .nr')) === 'POSITION 2');

await page.click('#fm-plus');
ok('Position dazu', (await page.$$('.pos')).length === 5);

// --- 4) Speichern -----------------------------------------------------------
console.log('\n4) Speichern');
await page.fill('#fm-kunde', 'Kunde AG');
await page.fill('#fm-lieferant', 'Lieferant GmbH');
await page.fill('#fm-m2', '12,5');
await page.click('#fm-speichern');
await page.waitForSelector('#scr-detail.aktiv');

const gesendet = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_speichern')[0]);
ok('nur ausgefuellte Positionen', gesendet.positionen.length === 2,
   JSON.stringify(gesendet.positionen));
ok('Komma wird zur Zahl', gesendet.positionen[0].kg === 3.4,
   'kg=' + JSON.stringify(gesendet.positionen[0].kg));
ok('Anzahl als Zahl', gesendet.positionen[0].anzahl === 120);
ok('bestehend als Boolean', gesendet.positionen[0].bestehend === true);
ok('zweite Position ohne Haken', gesendet.positionen[1].bestehend === false);
ok('m2 mit Komma', gesendet.lagerM2 === 12.5, 'lagerM2=' + JSON.stringify(gesendet.lagerM2));
ok('leeres kg bleibt leer', gesendet.positionen[1].kg === '');
ok('Regalplatz schon beim Erfassen', gesendet.positionen[0].regalplatz === 'A-12',
   JSON.stringify(gesendet.positionen[0].regalplatz));
ok('nur Angenommen quittiert',
   JSON.stringify(gesendet.schritte) === '["angenommen"]',
   JSON.stringify(gesendet.schritte));
ok('Sitzung mitgeschickt', gesendet.session === 'tok');
ok('Vorgangsschluessel mitgeschickt',
   typeof gesendet.vorgang === 'string' && gesendet.vorgang.length > 8,
   JSON.stringify(gesendet.vorgang));

// --- 5) Detail und Quittieren ----------------------------------------------
console.log('\n5) Detail und Quittieren');
ok('Titel ist die WE-Nummer', (await page.textContent('#dt-titel')) === 'WE-2026-0001');
ok('Angenommen beim Erfassen quittiert, kein Knopf',
   !(await page.$('.schritt [data-schritt="angenommen"]')));
ok('Gezaehlt mit Knopf', !!(await page.$('.schritt [data-schritt="gezaehlt"]')));
ok('Eingelagert mit Knopf', !!(await page.$('.schritt [data-schritt="eingelagert"]')));

await page.click('[data-schritt="gezaehlt"]');
await page.waitForFunction(() =>
  !document.querySelector('[data-schritt="gezaehlt"]'));
ok('nach Quittieren kein Knopf mehr', !(await page.$('[data-schritt="gezaehlt"]')));
ok('Quittierung sichtbar',
   (await page.textContent('#dt-schritte')).includes('Anna Muster'));

// --- 6) Einlagern mit Regalplatz -------------------------------------------
console.log('\n6) Einlagern');
await page.click('[data-schritt="eingelagert"]');
await page.waitForSelector('#scr-regal.aktiv');
ok('ein Feld je Position', (await page.$$('#rg-liste input')).length === 2);
ok('erfasster Regalplatz vorbelegt',
   (await page.inputValue('#rg-liste input[data-nr="1"]')) === 'A-12');
await page.fill('#rg-liste input[data-nr="1"]', 'A-12');
await page.fill('#rg-liste input[data-nr="2"]', 'B-03');
await page.click('#rg-senden');
await page.waitForSelector('#scr-detail.aktiv');

const schritt = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_schritt').pop());
ok('Regalplaetze nach Nummer geordnet',
   JSON.stringify(schritt.regalplaetze) === '["A-12","B-03"]',
   JSON.stringify(schritt.regalplaetze));
ok('Regalplatz im Detail sichtbar',
   (await page.textContent('#dt-positionen')).includes('A-12'));

// --- 7) Excel senden --------------------------------------------------------
console.log('\n7) Excel senden');
await page.click('#dt-senden');
await page.waitForSelector('#dlg-frage.zeigen');
ok('fragt vor dem Versand nach', await page.isVisible('#frage-text'));
await page.click('#frage-ja');
await page.waitForFunction(() =>
  window.__gesendet.some(x => x.action === 'we_senden'));
ok('Sendeauftrag mit WE-Nummer', (await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_senden')[0])).weNr === 'WE-2026-0001');

// --- 8) Erfassen ohne eigene Quittung --------------------------------------
console.log('\n8) Erfassen ohne eigene Quittung');
await page.click('#dt-zurueck');
await page.waitForSelector('#scr-start.aktiv');
await page.click('#st-neu');
await page.waitForSelector('#scr-form.aktiv');
ok('Auswahl steht wieder auf Angenommen', await page.isChecked('#fm-s-angenommen'));

await page.uncheck('#fm-s-angenommen');
await feld(0, 'artikel', 'Nur abgetippt');
await page.fill('#fm-kunde', 'Kunde AG');
await page.click('#fm-speichern');
await page.waitForSelector('#scr-detail.aktiv');

const ohne = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_speichern').pop());
ok('keine Quittung mitgeschickt', JSON.stringify(ohne.schritte) === '[]',
   JSON.stringify(ohne.schritte));
ok('Angenommen jetzt quittierbar', !!(await page.$('[data-schritt="angenommen"]')));
ok('alle drei Schritte offen',
   (await page.$$('.schritt [data-schritt]')).length === 3);

await page.click('[data-schritt="angenommen"]');
await page.waitForFunction(() => !document.querySelector('[data-schritt="angenommen"]'));
ok('nach dem Nachtragen kein Knopf mehr',
   !(await page.$('[data-schritt="angenommen"]')));

// --- 9) Verwaltung ---------------------------------------------------------
console.log('\n9) Verwaltung');
await page.click('#dt-zurueck');
await page.waitForSelector('#scr-start.aktiv');
await page.click('#st-admin');
await page.waitForSelector('#scr-admin.aktiv');
await page.waitForFunction(() => document.getElementById('adm-mailan').value !== '');

ok('auch die Verwaltung ruft nacheinander',
   (await page.evaluate(() => window.__hoechstens)) === 1,
   'hoechstens ' + (await page.evaluate(() => window.__hoechstens)) + ' gleichzeitig');
ok('Empfaengeradresse geladen',
   (await page.inputValue('#adm-mailan')) === 'lager@firma.ch');
ok('Ordner-ID geladen', (await page.inputValue('#adm-archiv')) === '1Arch');
ok('Ordnername statt blosser ID',
   (await page.textContent('#adm-archiv-name')).includes('Wareneingang Archiv'));
ok('leerer Ordner erklaert sich',
   (await page.textContent('#adm-foto-name')).includes('übersprungen'));
ok('Sicherungsordner wird gewarnt',
   (await page.textContent('#adm-sicherung-name')).includes('niemandem'));

await page.fill('#adm-mailan', 'neu@firma.ch');
await page.fill('#adm-foto', 'https://drive.google.com/drive/folders/1Foto');
await page.click('#adm-par');
await page.waitForFunction(() =>
  window.__gesendet.some(x => x.action === 'admin_parameter' && x.werte));
const par = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'admin_parameter' && x.werte).pop());
ok('neue Adresse mitgeschickt', par.werte.MailAn === 'neu@firma.ch',
   JSON.stringify(par.werte));
ok('eingefuegte Ordner-Adresse mitgeschickt',
   par.werte.FotoOrdner === 'https://drive.google.com/drive/folders/1Foto');
ok('Sicherungsordner mitgeschickt', par.werte.SicherungOrdner === '',
   JSON.stringify(par.werte.SicherungOrdner));

// Der Weg, der schon da war: Benutzer anlegen und Zugangsmail verschicken
await page.fill('#adm-name', 'Bob Meier');
await page.fill('#adm-email', 'bob@firma.ch');
await page.check('#adm-mail');
await page.click('#adm-neu');
await page.waitForSelector('#dlg-pw.zeigen');
const neu = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'admin_neu').pop());
ok('Benutzer mit Mailwunsch angelegt',
   neu.email === 'bob@firma.ch' && neu.mail === true, JSON.stringify(neu));
ok('Passwort wird einmal gezeigt',
   (await page.textContent('#pw-wert')) === 'Xy7k9m2Qw4');
await page.click('#pw-fertig');

await page.click('#adm-zurueck');
await page.waitForSelector('#scr-start.aktiv');
await page.click('#st-abmelden');
await page.waitForSelector('#scr-login.aktiv');
const ab = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'abmelden').pop());
ok('Abmelden sagt es dem Server', ab && ab.session === 'tok', JSON.stringify(ab));
ok('lokal auch vergessen',
   (await page.evaluate(() => localStorage.getItem('session'))) === null);

// Wieder anmelden fuer die restlichen Abschnitte
await page.fill('#lg-email', 'anna@firma.ch');
await page.fill('#lg-pass', 'geheim123');
await page.click('#lg-senden');
await page.waitForSelector('#scr-start.aktiv');

// --- 10) Zweiter Versuch nach Verbindungsabbruch ---------------------------
console.log('\n10) Zweiter Versuch nach Verbindungsabbruch');
await page.click('#st-neu');
await page.waitForSelector('#scr-form.aktiv');
await feld(0, 'artikel', 'Nach Funkloch');
await page.fill('#fm-kunde', 'Kunde AG');

// Das Netz bricht ab, nachdem der Aufruf raus ist — genau der Fall, in dem
// die App frueher «wurde nicht gespeichert» behauptete.
await page.evaluate(() => {
  window.__echt = window.fetch;
  // Der Server bekommt den Aufruf und schreibt die Zeile — nur die Antwort
  // kommt nicht mehr an. Genau so sieht ein Funkloch im Lager aus.
  window.fetch = async (url, opt) => {
    await window.__echt(url, opt);
    throw new Error('offline');
  };
});
await page.click('#fm-speichern');
await page.waitForFunction(() =>
  document.getElementById('toast').textContent.includes('doppelt wird es nicht'));
ok('Meldung behauptet nicht, es sei nichts gespeichert',
   (await page.textContent('#toast')).includes('nochmals speichern'));

await page.evaluate(() => { window.fetch = window.__echt; });
await page.click('#fm-speichern');
await page.waitForSelector('#scr-detail.aktiv');

const zwei = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_speichern').slice(-2));
ok('zweiter Versuch traegt denselben Schluessel',
   zwei[0].vorgang && zwei[0].vorgang === zwei[1].vorgang,
   JSON.stringify(zwei.map(x => x.vorgang)));
ok('Server meldet die Wiederholung, App sagt es',
   (await page.textContent('#toast')).includes('war schon gespeichert'),
   await page.textContent('#toast'));

await page.click('#dt-zurueck');
await page.waitForSelector('#scr-start.aktiv');
await page.click('#st-neu');
await page.waitForSelector('#scr-form.aktiv');
const neuerSchluessel = await page.evaluate(() => S.vorgang);
ok('neues Formular, neuer Schluessel', neuerSchluessel !== zwei[0].vorgang,
   neuerSchluessel);
await page.click('#fm-zurueck');
await page.waitForSelector('#scr-start.aktiv');

// --- Suche: ohne sie ist ein alter Beleg aus der App nicht erreichbar -----
console.log('\n10b) Suche in der Uebersicht');
ok('ohne Suche steht «Offene und letzte»',
   (await page.textContent('#st-titel')) === 'Offene und letzte');

await page.fill('#st-suche', 'nordwind');
await page.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('Nordwind'));
ok('Titel wechselt auf Suche', (await page.textContent('#st-titel')) === 'Suche');
const gesucht = await page.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_liste').pop());
ok('Suchbegriff mitgeschickt', gesucht.suche === 'nordwind', JSON.stringify(gesucht.suche));
ok('fremder abgeschlossener Eintrag gefunden',
   (await page.textContent('#st-liste')).includes('WE-2026-0009'));
ok('fremder Erfasser wird genannt',
   (await page.textContent('#st-liste')).includes('Bob Meier'));
ok('bereits versandt ist markiert',
   !!(await page.$('#st-liste .marke.versandt')));

await page.fill('#st-suche', 'gibtsnicht');
await page.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('Nichts gefunden'));
ok('leere Suche sagt es', (await page.textContent('#st-liste')).includes('Nichts gefunden'));

await page.fill('#st-suche', '');
// Auf die Liste warten, nicht auf den Titel: den setzt ladeListe() sofort,
// noch bevor der Aufruf hinausgeht — danach steht in der Liste «Wird
// geladen …» und noch nicht der Eintrag. Der Titel als Signal liess diese
// Pruefung etwa jedes fuenfte Mal zu frueh laufen.
await page.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('WE-2026-0001'));
ok('leeres Feld zeigt wieder die Uebersicht',
   (await page.textContent('#st-titel')) === 'Offene und letzte' &&
   (await page.textContent('#st-liste')).includes('WE-2026-0001'));

await page.click('#st-admin');
await page.waitForSelector('#scr-admin.aktiv');
// Erst weiter, wenn beide Aufrufe des Adminbereichs durch sind. Sonst
// laeuft einer von ihnen noch, waehrend der naechste Abschnitt fetch
// austauscht — und faellt dann in dessen «Sitzung abgelaufen».
await page.waitForFunction(() =>
  document.getElementById('adm-mailan').value !== '' &&
  document.getElementById('adm-liste').textContent.includes('Anna Muster'));

// --- 11) Abgelaufene Sitzung ------------------------------------------------
console.log('\n11) Abgelaufene Sitzung');
await page.evaluate(() => {
  window.fetch = async () => ({ text: async () => '{"ok":false,"error":"session"}',
                                json: async () => ({ ok: false, error: 'session' }) });
});
// Ein Klick, der wirklich zum Server geht — «Zurück» allein tut es nicht.
await page.click('#adm-par');
await page.waitForSelector('#scr-login.aktiv');
ok('faellt auf den Login zurueck', await sichtbar('#scr-login'));
ok('Sitzung geloescht', (await page.evaluate(() => localStorage.getItem('session'))) === null);

// --- 10) Nicht verbunden, falsch bereitgestellt ----------------------------
console.log('\n12) Klartext statt «Keine Verbindung»');
await page.evaluate(() => { CONFIG.url = ''; });
await page.fill('#lg-email', 'anna@firma.ch');
await page.fill('#lg-pass', 'geheim123');
await page.click('#lg-senden');
await page.waitForSelector('#lg-meldung.zeigen');
ok('fehlende Adresse wird benannt',
   (await page.textContent('#lg-meldung')).includes('CONFIG.url'),
   await page.textContent('#lg-meldung'));

// Der haeufigste Fall: die Bereitstellung ist nicht oeffentlich, Google
// schickt eine Anmeldeseite, und die App meldete bisher «Keine Verbindung».
await page.evaluate(() => {
  CONFIG.url = 'https://example.test/exec';
  window.fetch = async () => ({ status: 200,
    text: async () => '<!DOCTYPE html><title>Anmelden</title>' });
});
await page.click('#lg-senden');
await page.waitForFunction(() =>
  document.getElementById('lg-meldung').textContent.includes('Bereitstellung'));
ok('Antwort ohne JSON wird benannt',
   (await page.textContent('#lg-meldung')).includes('/exec'),
   await page.textContent('#lg-meldung'));

// --- 13) Was gar nicht erst nach draussen geht -----------------------------
console.log('\n13) Keine Adresse mit Sitzungstoken, kein fremder Host');
const methoden = await page.evaluate(() => window.__methoden);
ok('alle Aufrufe gehen als POST', methoden.every(m => m === 'POST'),
   JSON.stringify([...new Set(methoden)]));
ok('kein Stylesheet von fremdem Host',
   (await page.$$('link[rel=stylesheet]')).length === 0);

// --- 14) Wiederholt wird nur, was gefahrlos ist ----------------------------
console.log('\n14) Wiederholung nur, wo sie gefahrlos ist');

const lesen = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => {
    n++;
    if (n === 1) throw new TypeError('Failed to fetch');
    return { status: 200, text: async () => JSON.stringify({ ok: true, liste: [] }) };
  };
  const r = await post({ action: 'we_liste', session: 'tok' });
  return { n: n, ok: r.ok };
});
ok('Lesen ueberlebt einen Aussetzer', lesen.n === 2 && lesen.ok === true,
   JSON.stringify(lesen));

const erfassen = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => { n++; throw new TypeError('Failed to fetch'); };
  try { await post({ action: 'we_speichern', vorgang: 'v1' }); } catch (e) {}
  return n;
});
ok('Erfassen darf wiederholt werden', erfassen === 2, String(erfassen));

// Das ist der eigentliche Punkt: ein zweites Quittieren faende den Schritt
// schon quittiert, ein zweites Senden schickte die Mail zweimal.
const quittieren = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => { n++; throw new TypeError('Failed to fetch'); };
  let fehler = '';
  try { await post({ action: 'we_schritt', session: 'tok' }); } catch (e) { fehler = e.message; }
  return { n: n, fehler: fehler };
});
ok('Quittieren wird NICHT wiederholt', quittieren.n === 1, JSON.stringify(quittieren));
ok('und meldet kein_netz', quittieren.fehler === 'kein_netz', quittieren.fehler);

const senden = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => { n++; throw new TypeError('Failed to fetch'); };
  try { await post({ action: 'we_senden', session: 'tok' }); } catch (e) {}
  return n;
});
ok('Senden wird NICHT wiederholt', senden === 1, String(senden));

// Hat der Server geantwortet, nur nicht mit JSON, hilft kein zweiter Versuch
const kein_json = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => { n++; return { status: 200, text: async () => '<html>' }; };
  let fehler = '';
  try { await post({ action: 'we_liste', session: 'tok' }); } catch (e) { fehler = e.message; }
  return { n: n, fehler: fehler };
});
ok('Antwort ohne JSON wird nicht wiederholt',
   kein_json.n === 1 && kein_json.fehler === 'keine_antwort', JSON.stringify(kein_json));

// Jede Flaeche muss denselben Klartext zeigen, nicht nur Anmeldung und
// Speichern — sonst sieht eine falsche Bereitstellung aus wie ein Funkloch.
const flaechen = await page.evaluate(async () => {
  window.fetch = async () => ({ status: 200, text: async () => '<html>Anmelden</html>' });
  localStorage.setItem('session', 'tok');
  await ladeListe();
  const liste = document.getElementById('st-liste').textContent;
  await detailOeffnen('WE-2026-0001');
  const detail = document.getElementById('dt-schritte').textContent;
  return { liste: liste, detail: detail };
});
ok('Liste nennt die Bereitstellung', flaechen.liste.includes('Bereitstellung'), flaechen.liste);
// Ohne Statuszahl und Anfang der Antwort bleibt «kein JSON» eine Diagnose
// ohne Befund: 200 mit HTML, 401 und 429 verlangen verschiedene Schritte.
ok('Liste nennt die Statuszahl', flaechen.liste.includes('HTTP 200'), flaechen.liste);
ok('Liste zeigt den Anfang der Antwort',
   flaechen.liste.includes('<html>Anmelden</html>'), flaechen.liste);

// Beobachtet im Betrieb: Google antwortet einmal mit 404, nach dem naechsten
// Versuch geht es. Das Skript lief dabei nicht — also wiederholen, auch bei
// Aufrufen, die sonst kein zweites Mal geschickt werden duerfen.
const einmal404 = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => {
    n++;
    if (n === 1) return { status: 404, text: async () => '<!DOCTYPE html>' };
    return { status: 200, text: async () => JSON.stringify({ ok: true, liste: [] }) };
  };
  const r = await post({ action: 'we_liste', session: 'tok' });
  return { n: n, ok: r.ok };
});
ok('ein einzelnes 404 wird ueberstanden',
   einmal404.n === 2 && einmal404.ok === true, JSON.stringify(einmal404));

// Auch beim Quittieren: bei 404 ist nachweislich nichts geschehen, also kann
// der zweite Versuch nichts doppelt tun.
const schritt404 = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => {
    n++;
    if (n === 1) return { status: 503, text: async () => 'Service Unavailable' };
    return { status: 200, text: async () => JSON.stringify({ ok: true }) };
  };
  const r = await post({ action: 'we_schritt', session: 'tok' });
  return { n: n, ok: r.ok };
});
ok('auch Quittieren ueberlebt ein 503', schritt404.n === 2 && schritt404.ok === true,
   JSON.stringify(schritt404));

// 200 mit HTML ist etwas anderes: da hat das Skript geantwortet, nur falsch.
// Ein zweiter Versuch aendert daran nichts und unterbleibt.
const zweihundert = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => { n++; return { status: 200, text: async () => '<html>' }; };
  try { await post({ action: 'we_liste', session: 'tok' }); } catch (e) {}
  return n;
});
ok('200 mit HTML wird nicht wiederholt', zweihundert === 1, String(zweihundert));

// 403 ist ein Rechteproblem — Wiederholen hilft nie
const dreiNull3 = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => { n++; return { status: 403, text: async () => '<html>' }; };
  try { await post({ action: 'we_liste', session: 'tok' }); } catch (e) {}
  return n;
});
ok('403 wird nicht wiederholt', dreiNull3 === 1, String(dreiNull3));

// Der Fall aus dem Betrieb: Apps Script leitet den POST um, der Browser
// folgt mit GET, der Rumpf ist weg — doGet() antwortet, das Skript tat
// nichts. Ein zweiter Versuch erledigt es, auch beim Quittieren.
const verlorenerRumpf = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => {
    n++;
    const o = n === 1 ? { ok: false, error: 'nur_post', hinweis: 'nur CSV' }
                      : { ok: true };
    return { status: 200, text: async () => JSON.stringify(o) };
  };
  const r = await post({ action: 'we_schritt', session: 'tok' });
  return { n: n, ok: r.ok };
});
ok('verlorener Rumpf wird noch einmal geschickt',
   verlorenerRumpf.n === 2 && verlorenerRumpf.ok === true,
   JSON.stringify(verlorenerRumpf));

const immerGet = await page.evaluate(async () => {
  let n = 0;
  window.fetch = async () => {
    n++;
    return { status: 200,
             text: async () => JSON.stringify({ ok: false, error: 'nur_post' }) };
  };
  try { await post({ action: 'we_liste', session: 'tok' }); }
  catch (e) { return { n: n, text: verbindungText(e) }; }
  return { n: n, text: '' };
});
ok('zweimal verloren wird nicht endlos wiederholt', immerGet.n === 2,
   String(immerGet.n));
ok('und die Meldung bittet um einen neuen Versuch',
   immerGet.text.includes('noch einmal versuchen'), immerGet.text);
ok('ohne die Bereitstellung zu verdaechtigen',
   !immerGet.text.includes('Bereitstellung'), immerGet.text);

// Lehnt der Server ab, muss der Grund sichtbar sein. «Nicht geladen»
// allein schickt einen auf die Suche nach einem Netzproblem, das es nicht
// gibt — und der Zaehler darf nicht weiter Eintraege behaupten.
const abgelehnt = await page.evaluate(async () => {
  document.getElementById('st-zahl').textContent = '2 Einträge';
  window.fetch = async () => ({ status: 200, text: async () =>
    JSON.stringify({ ok: false, error: 'Exception: Blatt fehlt: Positionen' }) });
  localStorage.setItem('session', 'tok');
  await ladeListe();
  return { liste: document.getElementById('st-liste').textContent,
           zahl: document.getElementById('st-zahl').textContent };
});
ok('abgelehnter Aufruf nennt den Grund',
   abgelehnt.liste.includes('Blatt fehlt: Positionen'), abgelehnt.liste);
ok('der Zaehler behauptet nichts mehr', abgelehnt.zahl === '', abgelehnt.zahl);

const bekannt = await page.evaluate(async () => {
  window.fetch = async () => ({ status: 200, text: async () =>
    JSON.stringify({ ok: false, error: 'nur_post' }) });
  await ladeListe();
  return document.getElementById('st-liste').textContent;
});
ok('bekannter Grund bekommt einen Satz statt eines Codes',
   bekannt.includes('ohne Inhalt') && !bekannt.includes('nur_post'), bekannt);

// Bleibt es auch beim zweiten Mal bei 404, sagt die Meldung, was zu tun ist
const zweimal404 = await page.evaluate(async () => {
  window.fetch = async () => ({ status: 404, text: async () => '<!DOCTYPE html>' });
  try { await post({ action: 'we_liste', session: 'tok' }); }
  catch (e) { return verbindungText(e); }
  return '';
});
ok('anhaltendes 404 nennt CONFIG.url',
   zweimal404.includes('404') && zweimal404.includes('CONFIG.url'), zweimal404);
ok('und sagt, dass auch der zweite Versuch scheiterte',
   zweimal404.includes('zweite Versuch'), zweimal404);
ok('Detail nennt die Bereitstellung', flaechen.detail.includes('Bereitstellung'), flaechen.detail);

// --- 15) Aeltere Bereitstellung ---------------------------------------------
// Front und Backend werden nicht im selben Augenblick aktualisiert. Kennt
// das Skript «start» noch nicht, muss die App trotzdem starten — auf dem
// alten Weg, langsamer, aber sie startet.
console.log('\n15) Aeltere Bereitstellung ohne «start»');
const alt = await browser.newPage();
alt.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await alt.addInitScript(attrappe);
await alt.addInitScript(() => { window.__ohneStart = true; });
await alt.goto(APP);
await alt.fill('#lg-email', 'anna@firma.ch');
await alt.fill('#lg-pass', 'geheim123');
await alt.click('#lg-senden');
await alt.waitForSelector('#scr-start.aktiv');
await alt.waitForFunction(() => document.querySelectorAll('#dl-kunden option').length > 0);
ok('App startet auch ohne die neue Aktion',
   await alt.$eval('#scr-start', e => e.classList.contains('aktiv')));
ok('faellt auf die beiden alten Aufrufe zurueck',
   (await alt.evaluate(() => window.__gesendet.map(x => x.action))).join(',') ===
     'login,start,we_liste,stammdaten',
   (await alt.evaluate(() => window.__gesendet.map(x => x.action))).join(','));
ok('Stammdaten stehen trotzdem',
   (await alt.$$('#dl-kunden option')).length === 1);
ok('auch dabei geht nur ein Aufruf zur Zeit',
   (await alt.evaluate(() => window.__hoechstens)) === 1);

// Das zweite Mal wird der vergebliche Weg nicht wiederholt.
await alt.evaluate(() => { window.__gesendet.length = 0; });
await alt.evaluate(() => start());
await alt.waitForFunction(() => window.__gesendet.length >= 2);
ok('der vergebliche Aufruf wird nicht wiederholt',
   (await alt.evaluate(() => window.__gesendet.map(x => x.action))).join(',') ===
     'we_liste,stammdaten',
   (await alt.evaluate(() => window.__gesendet.map(x => x.action))).join(','));
await alt.close();

// --- 19) Nichts wegwerfen, was schon richtig dasteht ------------------------
// Aus dem Betrieb: acht Sekunden fuer die Liste, acht fuers Detail, und noch
// einmal acht beim Zurueckgehen — obwohl die Liste da schon fertig auf dem
// Schirm stand und nur vom Ladehinweis zugedeckt wurde.
console.log('\n19) Nichts wegwerfen, was schon richtig dasteht');
const flott = await browser.newPage();
flott.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await flott.addInitScript(attrappe);
await flott.goto(APP);
await flott.fill('#lg-email', 'anna@firma.ch');
await flott.fill('#lg-pass', 'geheim123');
await flott.click('#lg-senden');
await flott.waitForSelector('#scr-start.aktiv');

await flott.click('#st-neu');
await flott.waitForSelector('#scr-form.aktiv');
await flott.fill('#fm-kunde', 'Kunde AG');
await flott.fill('#fm-lieferant', 'Lieferant GmbH');
await flott.fill('.pos[data-i="0"] [data-f="artikel"]', 'Schrauben M6');
await flott.click('#fm-speichern');
await flott.waitForSelector('#scr-detail.aktiv');
await flott.waitForFunction(() => !document.getElementById('dt-aktionen').hidden);
ok('das Detail merkt sich sein Dokument',
   !!(await flott.evaluate(() =>
     JSON.parse(localStorage.getItem('details') || '{}')['WE-2026-0001'])));

// Ab hier dauert jede Antwort lange — was der Schirm VORHER zeigt, zaehlt.
await flott.evaluate(() => { window.__langsam = 900; });

await flott.click('#dt-zurueck');
ok('die Liste steht beim Zurueckgehen sofort',
   (await flott.textContent('#st-liste')).includes('WE-2026-0001'),
   await flott.textContent('#st-liste'));
ok('und kein Ladehinweis deckt sie zu',
   !(await flott.textContent('#st-liste')).includes('Wird geladen'),
   await flott.textContent('#st-liste'));
await flott.waitForFunction(() =>
  window.__gesendet.filter(x => x.action === 'we_liste').length > 0);
ok('frisch geholt wird trotzdem, nur unsichtbar',
   (await flott.evaluate(() =>
     window.__gesendet.filter(x => x.action === 'we_liste').length)) > 0);

// Dasselbe Dokument ein zweites Mal: es steht sofort da.
await flott.click('#st-liste .eintrag');
ok('das Detail steht beim zweiten Mal sofort',
   (await flott.textContent('#dt-positionen')).includes('Schrauben M6'),
   await flott.textContent('#dt-positionen'));
ok('und sagt, dass der Stand vom Geraet ist',
   !(await flott.$eval('#dt-alt', e => e.hidden)) &&
   (await flott.textContent('#dt-alt')).includes('Gerät'),
   await flott.textContent('#dt-alt'));
await flott.waitForFunction(() => document.getElementById('dt-alt').hidden);
ok('frische Daten loeschen den Hinweis',
   await flott.$eval('#dt-alt', e => e.hidden));

// Eine Suche dagegen LEERT: die Zeilen gehoeren zu einer anderen Frage.
await flott.click('#dt-zurueck');
await flott.fill('#st-suche', 'nordwind');
await flott.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('Wird gesucht'));
ok('eine Suche raeumt die alten Zeilen weg',
   !(await flott.textContent('#st-liste')).includes('WE-2026-0001'),
   await flott.textContent('#st-liste'));
await flott.close();

// --- 18) Ein Detail, das nicht geladen hat, ist kein Detail ----------------
// Aus dem Betrieb: der Kopf zeigte WE-2026-0005, darunter stand die Meldung
// ueber die verlorene Anfrage — und beide Knoepfe waren da. S.detail hielt
// dabei noch das ZUVOR geoeffnete Dokument, und «Zurueckziehen» haette
// genau dieses zurueckgezogen.
console.log('\n18) Ein Detail, das nicht geladen hat, ist kein Detail');
const det = await browser.newPage();
det.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await det.addInitScript(attrappe);
await det.goto(APP);
await det.fill('#lg-email', 'anna@firma.ch');
await det.fill('#lg-pass', 'geheim123');
await det.click('#lg-senden');
await det.waitForSelector('#scr-start.aktiv');

// Ein Dokument anlegen und oeffnen — das ist der Stand, der spaeter nicht
// weiterwirken darf.
await det.click('#st-neu');
await det.waitForSelector('#scr-form.aktiv');
await det.fill('#fm-kunde', 'Kunde AG');
await det.fill('#fm-lieferant', 'Lieferant GmbH');
await det.fill('.pos[data-i="0"] [data-f="artikel"]', 'Schrauben M6');
await det.click('#fm-speichern');
// Nach dem Speichern steht das Detail schon offen.
await det.waitForSelector('#scr-detail.aktiv');
await det.waitForFunction(() => !document.getElementById('dt-aktionen').hidden);
ok('geladenes Detail zeigt seine Knoepfe',
   !(await det.$eval('#dt-aktionen', e => e.hidden)));
ok('und haelt sein Dokument',
   (await det.evaluate(() => S.detail && S.detail.kopf.WeNr)) === 'WE-2026-0001');

// Jetzt geht die Anfrage unterwegs verloren — zweimal, wie im Betrieb.
await det.evaluate(() => {
  window.__echt = window.fetch;
  window.fetch = async (url, opt) => {
    const d = JSON.parse(opt.body);
    if (d.action === 'we_detail') {
      return { status: 200, text: async () => '{"ok":false,"error":"nur_post"}' };
    }
    return window.__echt(url, opt);
  };
});
await det.evaluate(() => detailOeffnen('WE-2026-0009'));
await det.waitForSelector('#dt-nochmal');

ok('der Kopf zeigt das angefragte Dokument',
   (await det.textContent('#dt-titel')) === 'WE-2026-0009');
ok('das vorige Dokument wirkt nicht weiter',
   (await det.evaluate(() => S.detail)) === null,
   JSON.stringify(await det.evaluate(() => S.detail && S.detail.kopf.WeNr)));
ok('keine Knoepfe auf einem Dokument, das nicht da ist',
   await det.$eval('#dt-aktionen', e => e.hidden));
ok('der Positionszaehler behauptet nichts',
   (await det.textContent('#dt-poszahl')) === '');
ok('die Meldung nennt den Grund',
   (await det.textContent('#dt-schritte')).includes('ohne Inhalt'),
   await det.textContent('#dt-schritte'));

// Und ein Druck genuegt, statt zurueck in die Liste und wieder hinein.
await det.evaluate(() => { window.fetch = window.__echt; });
await det.click('#dt-nochmal');
await det.waitForFunction(() => !document.getElementById('dt-aktionen').hidden);
ok('«Nochmal versuchen» laedt dasselbe Dokument',
   (await det.evaluate(() => S.detail && S.detail.kopf.WeNr)) === 'WE-2026-0009',
   await det.evaluate(() => S.detail && S.detail.kopf.WeNr));
ok('und die Knoepfe sind wieder da',
   !(await det.$eval('#dt-aktionen', e => e.hidden)));
await det.close();

// --- 17) Alle Wareneingaenge, fuer den Admin --------------------------------
// Die Uebersicht ist eine Arbeitsliste: fremde Eintraege verschwinden aus
// ihr, sobald sie eingelagert sind. Fuer den Admin, der wissen will, was
// das Team ueberhaupt erfasst hat, gibt es einen Umschalter.
console.log('\n17) Alle Wareneingaenge, fuer den Admin');
const adm = await browser.newPage();
adm.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await adm.addInitScript(attrappe);
await adm.goto(APP);
await adm.fill('#lg-email', 'anna@firma.ch');
await adm.fill('#lg-pass', 'geheim123');
await adm.click('#lg-senden');
await adm.waitForSelector('#scr-start.aktiv');

ok('der Umschalter steht beim Admin', !(await adm.$eval('#st-alle', e => e.hidden)));
ok('und heisst zuerst «Alle»', (await adm.textContent('#st-alle')) === 'Alle');
ok('der fremde abgeschlossene Eintrag fehlt zunaechst',
   !(await adm.textContent('#st-liste')).includes('WE-2026-0009'));

await adm.click('#st-alle');
await adm.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('WE-2026-0009'));
ok('nach dem Umschalten ist er da',
   (await adm.textContent('#st-liste')).includes('WE-2026-0009'));
ok('die Ansicht wird mitgeschickt',
   (await adm.evaluate(() => window.__gesendet.filter(x => x.action === 'we_liste').pop()))
     .alle === true);
ok('die Ueberschrift sagt, welche Ansicht gilt',
   (await adm.textContent('#st-titel')) === 'Alle Wareneingänge',
   await adm.textContent('#st-titel'));
ok('und der Knopf bietet den Rueckweg an',
   (await adm.textContent('#st-alle')) === 'Nur offene');

// Die Wahl ueberlebt das Neuladen — sonst waehlt der Admin sie jeden Morgen neu
await adm.reload();
await adm.waitForSelector('#scr-start.aktiv');
await adm.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('WE-2026-0009'));
ok('die Wahl ueberlebt das Neuladen',
   (await adm.textContent('#st-alle')) === 'Nur offene' &&
   (await adm.textContent('#st-titel')) === 'Alle Wareneingänge');

await adm.click('#st-alle');
await adm.waitForFunction(() =>
  !document.getElementById('st-liste').textContent.includes('WE-2026-0009'));
ok('und zurueck geht es auch',
   (await adm.textContent('#st-titel')) === 'Offene und letzte');
await adm.close();

// Beim gewoehnlichen Benutzer gibt es den Knopf nicht. Das ist Bequemlichkeit,
// keine Sicherung — die Rolle prueft der Server (siehe backend.mjs, 20).
const bob = await browser.newPage();
bob.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await bob.addInitScript(attrappe);
await bob.addInitScript(() => { window.__nichtAdmin = true; });
await bob.goto(APP);
await bob.fill('#lg-email', 'bob@firma.ch');
await bob.fill('#lg-pass', 'geheim123');
await bob.click('#lg-senden');
await bob.waitForSelector('#scr-start.aktiv');
ok('gewoehnlicher Benutzer sieht den Umschalter nicht',
   await bob.$eval('#st-alle', e => e.hidden));
ok('und auch den Verwaltungsknopf nicht',
   await bob.$eval('#st-admin', e => e.hidden));
await bob.close();

// --- 16) Die Liste steht sofort ---------------------------------------------
// Der Weg zum Server dauert Sekunden. Solange auf «Wird geladen …» zu
// starren ist genau die Wartezeit, die weg sollte — also zeichnet die App
// zuerst, was das Geraet zuletzt gesehen hat, und sagt dabei, dass es alt ist.
console.log('\n16) Die Liste steht sofort');
const lok = await browser.newPage();
lok.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await lok.addInitScript(attrappe);
await lok.goto(APP);
await lok.fill('#lg-email', 'anna@firma.ch');
await lok.fill('#lg-pass', 'geheim123');
await lok.click('#lg-senden');
await lok.waitForSelector('#scr-start.aktiv');

// Ein Eintrag, damit es etwas zu merken gibt
await lok.click('#st-neu');
await lok.waitForSelector('#scr-form.aktiv');
await lok.fill('#fm-kunde', 'Kunde AG');
await lok.fill('#fm-lieferant', 'Lieferant GmbH');
await lok.fill('.pos[data-i="0"] [data-f="artikel"]', 'Schrauben M6');
await lok.click('#fm-speichern');
await lok.waitForFunction(() =>
  document.getElementById('st-liste').textContent.includes('WE-2026-0001'));
ok('die Liste wird gemerkt',
   (await lok.evaluate(() => JSON.parse(localStorage.getItem('liste') || 'null')
                              ?.liste?.length)) === 1);

// Jetzt langsam antworten und neu laden: die Zeilen muessen VOR der Antwort stehen
await lok.evaluate(() => localStorage.setItem('langsam', '1'));
await lok.addInitScript(() => { window.__langsam = 600; });
await lok.reload();
await lok.waitForSelector('#scr-start.aktiv');
ok('gezeichnet, bevor die Antwort da ist',
   (await lok.textContent('#st-liste')).includes('WE-2026-0001'),
   await lok.textContent('#st-liste'));
ok('und es steht dabei, dass der Stand vom Geraet ist',
   !(await lok.$eval('#st-alt', e => e.hidden)) &&
   (await lok.textContent('#st-alt')).includes('Gerät'),
   await lok.textContent('#st-alt'));
ok('kein «Wird geladen» ueber vorhandenen Zeilen',
   !(await lok.textContent('#st-liste')).includes('Wird geladen'));

// Sobald die frischen Zeilen da sind, verschwindet der Hinweis
await lok.waitForFunction(() => document.getElementById('st-alt').hidden);
ok('frische Zeilen loeschen den Hinweis',
   (await lok.$eval('#st-alt', e => e.hidden)) &&
   (await lok.textContent('#st-liste')).includes('WE-2026-0001'));

// Scheitert die Erneuerung, bleibt die alte Liste stehen — mit Grund
// Nach der Attrappe eingehaengt, also gewinnt es — und es steht schon,
// bevor start() den ersten Aufruf schickt. Danach eingesetzt waere es ein
// Rennen gegen den eigenen Start.
await lok.addInitScript(() => {
  window.__langsam = 0;
  window.fetch = async () => { throw new TypeError('Failed to fetch'); };
});
await lok.reload();
await lok.waitForSelector('#scr-start.aktiv');
await lok.waitForFunction(() =>
  document.getElementById('st-alt').textContent.includes('Verbindung'));
ok('nach einem Fehlschlag bleiben die alten Zeilen stehen',
   (await lok.textContent('#st-liste')).includes('WE-2026-0001'),
   await lok.textContent('#st-liste'));
ok('und der Hinweis nennt den Grund',
   (await lok.textContent('#st-alt')).includes('Gerät') &&
   (await lok.textContent('#st-alt')).includes('Verbindung'),
   await lok.textContent('#st-alt'));
// Auf einem geteilten iPad hat der naechste Benutzer die Kunden- und
// Lieferantennamen des vorigen nichts anzugehen.
await lok.evaluate(() => abmelden());
ok('Abmelden vergisst die gemerkte Liste',
   (await lok.evaluate(() => localStorage.getItem('liste'))) === null);
await lok.close();

// --- 20) Das Foto kommt vom Server, nicht aus Drive -------------------------
// Ein Lagermitarbeiter hat keinen Drive-Zugriff. Ein Link dorthin wird vom
// BROWSER geholt, mit dem Google-Konto des Geraets — er sah «Zugriff
// verweigert» auf einem Beleg, der ihm gehoert.
console.log('\n20) Das Foto kommt vom Server, nicht aus Drive');

// Erst die Quelle: es darf gar keinen Drive-Link mehr geben. Kommentare
// vorher weg, sonst schlaegt die Pruefung auf der Erklaerung an, warum der
// Link fort ist — und man muesste zwischen Erklaerung und Pruefung waehlen.
{
  const roh = fs.readFileSync('index.html', 'utf8');
  const ohneKommentare = roh
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  ok('kein Drive-Link mehr im Client',
     !/drive\.google\.com/.test(ohneKommentare),
     (ohneKommentare.match(/.*drive\.google\.com.*/) || [''])[0].trim());
  ok('und die Pruefung wuerde einen finden',
     /drive\.google\.com/.test(ohneKommentare + 'href="https://drive.google.com/x"'));
}

const fot = await browser.newPage();
fot.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
await fot.addInitScript(attrappe);
await fot.addInitScript(() => { window.__mitFoto = true; });
await fot.goto(APP);
await fot.fill('#lg-email', 'anna@firma.ch');
await fot.fill('#lg-pass', 'geheim123');
await fot.click('#lg-senden');
await fot.waitForSelector('#scr-start.aktiv');
await fot.click('#st-neu');
await fot.waitForSelector('#scr-form.aktiv');
await fot.fill('#fm-kunde', 'Kunde AG');
await fot.fill('.pos[data-i="0"] [data-f="artikel"]', 'Schrauben M6');
await fot.click('#fm-speichern');
await fot.waitForSelector('#scr-detail.aktiv');
await fot.waitForSelector('#dt-foto');

ok('der Schauer liegt nicht ueber der App', await fot.$eval('#bild-schau', e => e.hidden));
await fot.click('#dt-foto');
await fot.waitForFunction(() => !document.getElementById('bild-schau').hidden);
ok('nach dem Antippen steht das Bild da',
   (await fot.$eval('#bild-schau-bild', e => e.getAttribute('src') || '')).startsWith('data:'),
   await fot.$eval('#bild-schau-bild', e => (e.getAttribute('src') || '').slice(0, 20)));
ok('geholt wurde es beim Server', (await fot.evaluate(() => window.__fotoAbrufe)) === 1);

// Schliessen und noch einmal: kein zweiter Weg zum Server
await fot.click('#bild-schau');
await fot.waitForFunction(() => document.getElementById('bild-schau').hidden);
ok('ein Tipp schliesst wieder', await fot.$eval('#bild-schau', e => e.hidden));
ok('und die Quelle bleibt nicht im Speicher stehen',
   !(await fot.$eval('#bild-schau-bild', e => e.getAttribute('src'))));

await fot.click('#dt-foto');
await fot.waitForFunction(() => !document.getElementById('bild-schau').hidden);
ok('das zweite Mal kommt aus dem Speicher',
   (await fot.evaluate(() => window.__fotoAbrufe)) === 1,
   String(await fot.evaluate(() => window.__fotoAbrufe)));

// Die App kann neuer sein als das Skript — ein Merge auf GitHub erneuert
// nur die Seite. Dann muss die Meldung sagen, WO das fehlt.
const veraltet = await fot.evaluate(() =>
  abgelehntText({ error: 'unbekannte Aktion' }, 'Foto nicht geladen'));
ok('eine aeltere Bereitstellung wird als solche benannt',
   veraltet.includes('Code.gs') && veraltet.includes('Version') &&
   !veraltet.includes('unbekannte Aktion'), veraltet);
ok('und ein unbekannter Grund nennt, was nicht kam',
   (await fot.evaluate(() => abgelehntText({ error: 'irgendwas' }, 'Foto nicht geladen')))
     .startsWith('Foto nicht geladen.'));

await fot.keyboard.press('Escape');
await fot.waitForFunction(() => document.getElementById('bild-schau').hidden);
ok('Escape schliesst auch', await fot.$eval('#bild-schau', e => e.hidden));
await fot.close();

// --- 21) Ein Foto je Position ----------------------------------------------
// Der Knopf sitzt in der Zeile des Regalplatzes — dort, wo die Ware vor
// einem steht und das Feld daneben ohnehin ausgefuellt wird.
console.log('\n21) Ein Foto je Position');
const pf = await browser.newPage();
pf.on('pageerror', e => { fail++; console.log('  FAIL  pageerror: ' + e.message); });
// Ein echtes, winziges PNG: bildVerkleinern laeuft ueber Image und canvas,
// und ein erfundener Puffer kaeme dort nie an.
const winzig = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mNk+M/wn4EIwDiqkL' +
  '4KAcT9A/0LrLLzAAAAAElFTkSuQmCC', 'base64');
pf.on('filechooser', async fc => {
  await fc.setFiles({ name: 'artikel.png', mimeType: 'image/png', buffer: winzig });
});
await pf.addInitScript(attrappe);
await pf.goto(APP);
await pf.fill('#lg-email', 'anna@firma.ch');
await pf.fill('#lg-pass', 'geheim123');
await pf.click('#lg-senden');
await pf.waitForSelector('#scr-start.aktiv');
await pf.click('#st-neu');
await pf.waitForSelector('#scr-form.aktiv');

ok('je Position ein Fotoknopf', (await pf.$$('.pos .pos-foto')).length === 5);
ok('und er steht in der Regalplatzzeile',
   (await pf.$$('.pos .regal-zeile [data-f="regalplatz"] ~ .pos-foto')).length === 5);

await pf.fill('#fm-kunde', 'Kunde AG');
await pf.fill('.pos[data-i="0"] [data-f="artikel"]', 'Schrauben M6');
await pf.click('.pos[data-i="0"] .pos-foto');
await pf.waitForFunction(() =>
  document.querySelector('.pos[data-i="0"] .pos-foto').classList.contains('hat-foto'));
ok('nach dem Knipsen ist der Knopf markiert',
   (await pf.textContent('.pos[data-i="0"] .pos-foto')).includes('✓'));
ok('und nur bei dieser Position',
   !(await pf.$eval('.pos[data-i="1"] .pos-foto', e => e.className.includes('hat-foto'))));

// Noch einmal antippen zeigt es — und laesst es entfernen
await pf.click('.pos[data-i="0"] .pos-foto');
await pf.waitForFunction(() => !document.getElementById('bild-schau').hidden);
ok('ein zweiter Tipp zeigt das Foto',
   (await pf.$eval('#bild-schau-bild', e => e.getAttribute('src') || '')).startsWith('data:'));
ok('mit der Moeglichkeit, es zu entfernen',
   !(await pf.$eval('#bild-schau-weg', e => e.hidden)));
await pf.click('#bild-schau-weg');
await pf.waitForFunction(() =>
  !document.querySelector('.pos[data-i="0"] .pos-foto').classList.contains('hat-foto'));
ok('entfernt ist entfernt', await pf.$eval('#bild-schau', e => e.hidden));

// Noch einmal knipsen und speichern: das Bild geht mit
await pf.click('.pos[data-i="0"] .pos-foto');
await pf.waitForFunction(() =>
  document.querySelector('.pos[data-i="0"] .pos-foto').classList.contains('hat-foto'));
await pf.click('#fm-speichern');
await pf.waitForSelector('#scr-detail.aktiv');
const gespeichert = await pf.evaluate(() =>
  window.__gesendet.filter(x => x.action === 'we_speichern').pop());
ok('das Bild wird mitgeschickt',
   String(gespeichert.positionen[0].bild).startsWith('data:image/jpeg'),
   String(gespeichert.positionen[0].bild).slice(0, 24));
ok('und nur bei der Position, die es hat',
   !gespeichert.positionen[1] || !gespeichert.positionen[1].bild);

// Im Detail bietet die Position ihr Foto an
await pf.waitForSelector('.dt-pos-foto');
ok('das Detail bietet das Foto der Position an',
   (await pf.$$('.dt-pos-foto')).length === 1);

// Beim Einlagern steht derselbe Knopf
await pf.click('[data-schritt="eingelagert"]');
await pf.waitForSelector('#scr-regal.aktiv');
ok('auch beim Einlagern ein Knopf je Position',
   (await pf.$$('#rg-liste .rg-foto')).length === (await pf.$$('#rg-liste input[data-nr]')).length);
ok('die schon erfasste Position ist markiert',
   await pf.$eval('#rg-liste .rg-foto', e => e.className.includes('hat-foto')));
await pf.close();

await browser.close();
console.log('\n' + '='.repeat(46));
console.log(pass + ' bestanden, ' + fail + ' gescheitert');
process.exit(fail ? 1 : 0);
