/**
 * Gibt eine Beispiel-CSV aus — genau das, was der Endpunkt liefert.
 * tests/vorlage.py fuellt damit die Excel-Vorlage und prueft, ob das
 * Formularblatt daraus die richtigen Werte zieht.
 *
 *     node tests/csv_beispiel.mjs > beispiel.csv
 */
import { neueTabelle, laden, mitBenutzer } from './gerippe.mjs';

const ss = neueTabelle();
const ctx = laden(ss);
const u = mitBenutzer(ctx, ss);
const bob = ctx.sitzungPruefen('tokB');

// 1) Vollstaendig quittiert, mit Sonderzeichen in den Feldern
const a = ctx.weSpeichern({
  kunde: 'Meier, Sohn & Co', lieferant: 'Wenger Verpackung',
  lagerM2: 12.5, bemerkung: 'Palette leicht beschädigt',
  positionen: [
    { artikel: 'Kartonage 600x400x300', anzahl: 120, kg: 48.5,
      mhd: '10.2027', bemerkung: '', bestehend: true },
    { artikel: 'Rohr "40mm"', anzahl: 36, kg: '',
      mhd: '', bemerkung: 'Rolle 2 eingedrückt', bestehend: false },
    { artikel: 'Etiketten A5', anzahl: 500, kg: 2,
      mhd: '', bemerkung: '', bestehend: false }
  ]
}, u).weNr;
ctx.weSchritt({ weNr: a, schritt: 'gezaehlt' }, bob);
ctx.weSchritt({ weNr: a, schritt: 'eingelagert',
                regalplaetze: ['A-12', 'B-03', 'C-07'] }, u);

// 2) Nur angenommen — Gez/Ein muessen im Formular leer bleiben
const b = ctx.weSpeichern({
  kunde: 'Zweiter Kunde AG', lieferant: 'Alpina Food', lagerM2: '',
  positionen: [
    { artikel: 'Mehl Type 550', anzahl: 40, kg: 1000,
      mhd: '31.12.2026', bemerkung: '', bestehend: true }
  ]
}, u).weNr;

// 3) Zurueckgezogen — darf in der CSV gar nicht auftauchen
const c = ctx.weSpeichern({ kunde: 'Storniert AG',
  positionen: [{ artikel: 'Darf nicht erscheinen', anzahl: 1, kg: '',
                 mhd: '', bemerkung: '', bestehend: false }] }, u).weNr;
ctx.weStorno({ weNr: c }, u);

process.stdout.write(ctx.csvExport());
process.stderr.write(['ERWARTET', a, b, c].join('\t') + '\n');
