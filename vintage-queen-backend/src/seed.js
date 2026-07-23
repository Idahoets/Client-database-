import db from './db.js';
import { getConsignorTasks } from './asana.js';

// Asana has no concept of the short code used in Clover SKUs/tags, so it has
// to be maintained here, keyed by Asana task gid (not name - names get
// typo'd and reformatted). Verified against the real Clover categories/item
// names pulled from the live account. Two are a bit fuzzy and worth
// double-checking with the shop:
//   - "Bob Hendry" (Asana) vs "Ben Hendry" (Clover category name) - same
//     person assumed, first name mismatch
//   - "Donna Crow" (Asana) vs code DCOX, i.e. "D. Cox" - assumed maiden/prior
//     surname, not verified
const CODE_BY_TASK_GID = {
  '1214466985331965': 'HEN',   // Bob Hendry
  '1215031968972107': 'DCOX',  // Donna Crow
  '1215842156429837': 'BENN',  // Scott Bennet
  '1215842156429841': 'RUTER', // Rod Ruter
  '1215842156429848': 'CBRU',  // Chris Brule
  '1215842156429850': 'COLS',  // Curtis Olson
  '1216838717056490': 'JBEN',  // Jan Benton
  '1216838717056497': 'LFAIR', // Laura Faircloth
  '1216838570025447': 'SMC',   // Shirley Mcdermott
  '1216838570025460': 'RM',    // Ron Moore
  '1216838570025475': 'JJ',    // Julie Jones
  '1216838570025482': 'SDAN',  // Sue Daniel
  '1216838570025489': 'MCK',   // Cindy Mckellip
  '1216838570025494': 'ANTT'   // Antonia Tamayo
};

const insert = db.prepare(`
  INSERT INTO consignors (code, name, type, contract_start, contract_end, estate_sale_date, contact_email)
  VALUES (@code, @name, @type, @contract_start, @contract_end, @estate_sale_date, @contact_email)
  ON CONFLICT(code) DO UPDATE SET
    name = excluded.name, type = excluded.type,
    contract_start = excluded.contract_start, contract_end = excluded.contract_end,
    estate_sale_date = excluded.estate_sale_date, contact_email = excluded.contact_email
`);

async function seedFromAsana() {
  const { tasks, flagged } = await getConsignorTasks();

  let seeded = 0, noCode = 0, incomplete = 0;

  for (const t of tasks) {
    // Historical/completed tasks mostly predate contract_start/due_on being
    // tracked - not enough data to seed a NOT NULL contract row, so skip
    // rather than guess a date.
    if (!t.contractStart || !t.contractEnd) {
      incomplete++;
      continue;
    }

    const code = CODE_BY_TASK_GID[t.gid];
    if (!code) {
      noCode++;
      console.warn(`No Clover code mapped yet for "${t.name}" (gid ${t.gid}) - not seeded. Add it to CODE_BY_TASK_GID once known.`);
      continue;
    }

    insert.run({
      code,
      name: t.name,
      type: t.type,
      contract_start: t.contractStart,
      contract_end: t.contractEnd,
      estate_sale_date: t.estateSaleDate,
      contact_email: t.email
    });
    seeded++;
  }

  for (const f of flagged) {
    console.warn(`Possible duplicate: "${f.task}" (gid ${f.gid}) looks like the same person as "${f.duplicateOf.task}" (gid ${f.duplicateOf.gid}) - not auto-merged, resolve in Asana.`);
  }

  console.log(`Seeded ${seeded} consignors from Asana. ${noCode} skipped (no Clover code mapped), ${incomplete} skipped (missing contract dates), ${flagged.length} possible duplicates flagged above.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFromAsana().catch(err => {
    console.error('Seed from Asana failed:', err.message);
    process.exit(1);
  });
}

export default seedFromAsana;
