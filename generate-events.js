/**
 * generate-events.js
 *
 * Reads "Lineup 2026.xlsx" (first sheet) from the same folder and writes
 * "events.json" next to it.
 *
 * Usage:  node generate-events.js
 *    or:  npm run generate
 *
 * The Excel sheet must have these column headers (matching events.json fields):
 *   sequenceId | description1 | description2 | durationMinutes |
 *   expectedStartTime | prepTime | performers_speakers | Coordinator
 */

'use strict';

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const XLSX_FILE = path.join(__dirname, 'Lineup2026.xlsx');
const JSON_FILE = path.join(__dirname, 'events.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an Excel time serial (fraction of a day) or plain string → "HH:MM" or "HH:MM:SS". */
function xlTimeToStr(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'string') return val.trim() || null;
  // Excel stores time-of-day as a fraction of 24 h (e.g. 0.6667 = 16:00)
  if (typeof val === 'number' && val >= 0 && val < 1) {
    const totalSec = Math.round(val * 86400);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => (n < 10 ? '0' : '') + n;
    return s > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
  }
  return String(val);
}

/** Coerce a cell value to a finite number or null. */
function xlNum(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

/** Coerce a cell value to a trimmed non-empty string or null. */
function xlStr(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(XLSX_FILE)) {
  console.error(`\n❌  File not found: ${XLSX_FILE}`);
  console.error('    Place "Lineup 2026.xlsx" in the same folder as this script and try again.\n');
  process.exit(1);
}

console.log(`Reading: ${XLSX_FILE}`);

const wb   = XLSX.readFile(XLSX_FILE, { cellDates: false });
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

console.log(`  → ${rows.length} rows found on sheet "${wb.SheetNames[0]}"`);

const items = rows
  .map(row => ({
    sequenceId:        xlNum(row['sequenceId']),
    description1:      xlStr(row['description1']),
    description2:      xlStr(row['description2']),
    durationMinutes:   xlNum(row['durationMinutes']),
    expectedStartTime: xlTimeToStr(row['expectedStartTime']),
    prepTime:          xlNum(row['prepTime']),
    'Presenter(s)':    xlStr(row['performers_speakers']),
    coordinator:       xlStr(row['Coordinator'] ?? row['coordinator']),
  }))
  .filter(item =>
    // Drop blank rows (nothing useful in them)
    item.sequenceId !== null || item.description1 !== null || item.description2 !== null
  );

if (items.length === 0) {
  console.error('\n❌  No data rows found after filtering.');
  console.error('    Check that the first sheet has the correct column headers.\n');
  process.exit(1);
}

const output = JSON.stringify({ items }, null, 2);
fs.writeFileSync(JSON_FILE, output, 'utf8');

console.log(`  → ${items.length} items written`);
console.log(`\n✅  events.json written to: ${JSON_FILE}\n`);
