import { createRequire } from 'node:module';

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
await page.addInitScript(() => {
  window.__gesendet = [];
  window.__methoden = [];
  const DB = { kopf: null, positionen: [] };
  // Der weiteste quittierte Schritt, wie statusAus() im Backend.
  const status = () => DB.ein ? 'eingelagert' : DB.gez ? 'gezaehlt'
                             : DB.ang ? 'angenommen' : 'erfasst';

  window.fetch = async (url, opt) => {
    let d;
    if (opt && opt.body) d = JSON.parse(opt.body);
    else d = Object.fromEntries(new URL('http://x/' + url.replace(/^[^?]*/, '')).searchParams);
    window.__gesendet.push(d);
    window.__methoden.push(opt && opt.method ? opt.method : 'GET');

    const A = o => ({ text: async () => JSON.stringify(o), json: async () => o, status: 200 });

    switch (d.action) {
      case 'login':
        return A({ ok: true, session: 'tok', name: 'Anna Muster',
                   rolle: 'admin', pwGeaendert: true });
      case 'stammdaten':
        return A({ ok: true, kunden: ['Kunde AG'], lieferanten: ['Lieferant GmbH'] });
      case 'we_liste': {
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
        if (!s) return A({ ok: true, liste: eigen });
        const passt = x => (x.weNr + ' ' + x.kunde + ' ' + x.lieferant + ' ' +
                            x.erfasser).toLowerCase().includes(s);
        return A({ ok: true, liste: eigen.concat([fremd]).filter(passt) });
      }
      case 'we_speichern': {
        DB.vorgaenge = DB.vorgaenge || {};
        if (d.vorgang && DB.vorgaenge[d.vorgang]) {
          return A({ ok: true, weNr: DB.vorgaenge[d.vorgang], wiederholt: true });
        }
        DB.vorgaenge[d.vorgang] = 'WE-2026-0001';
        DB.kopf = d;
        DB.positionen = d.positionen.map((p, i) => Object.assign({ nr: i + 1, regalplatz: '' }, p));
        const s = d.schritte || [];
        DB.ang = s.includes('angenommen')  ? 'Anna Muster' : '';
        DB.gez = s.includes('gezaehlt')    ? 'Anna Muster' : '';
        DB.ein = s.includes('eingelagert') ? 'Anna Muster' : '';
        DB.status = status();
        return A({ ok: true, weNr: 'WE-2026-0001' });
      }
      case 'we_detail':
        return A({ ok: true, positionen: DB.positionen, kopf: {
          WeNr: 'WE-2026-0001', Kunde: DB.kopf.kunde, Lieferant: DB.kopf.lieferant,
          LagerM2: String(DB.kopf.lagerM2), Bemerkung: DB.kopf.bemerkung,
          AngNam: DB.ang || '', AngDat: DB.ang ? '2026-09-09' : '',
          AngZeit: DB.ang ? '08:30' : '',
          GezNam: DB.gez || '', GezDat: DB.gez ? '2026-09-09' : '', GezZeit: DB.gez ? '09:00' : '',
          EinNam: DB.ein || '', EinDat: '', EinZeit: '',
          FotoUrl: '', Gesendet: '', Storniert: 'false', Status: DB.status } });
      case 'we_schritt':
        if (d.schritt === 'angenommen')  { DB.ang = 'Anna Muster'; }
        if (d.schritt === 'gezaehlt')    { DB.gez = 'Anna Muster'; }
        if (d.schritt === 'eingelagert') { DB.ein = 'Anna Muster';
          (d.regalplaetze || []).forEach((w, i) => { if (DB.positionen[i]) DB.positionen[i].regalplatz = w; }); }
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
});

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
ok('Adminknopf sichtbar fuer Admin', !(await page.$eval('#st-admin', e => e.hidden)));

// --- 2) Formular ------------------------------------------------------------
console.log('\n2) Formular');
await page.click('#st-neu');
await page.waitForSelector('#scr-form.aktiv');
ok('5 Leerzeilen wie auf dem Papier', (await page.$$('.pos')).length === 5);
ok('Regalplatzfeld je Position',
   (await page.$$('.pos [data-f="regalplatz"]')).length === 5);
ok('Angenommen vorausgewaehlt', await page.isChecked('#fm-s-angenommen'));
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
await page.waitForFunction(() =>
  document.getElementById('st-titel').textContent === 'Offene und letzte');
ok('leeres Feld zeigt wieder die Uebersicht',
   (await page.textContent('#st-liste')).includes('WE-2026-0001'));

await page.click('#st-admin');
await page.waitForSelector('#scr-admin.aktiv');

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
ok('Detail nennt die Bereitstellung', flaechen.detail.includes('Bereitstellung'), flaechen.detail);

await browser.close();
console.log('\n' + '='.repeat(46));
console.log(pass + ' bestanden, ' + fail + ' gescheitert');
process.exit(fail ? 1 : 0);
