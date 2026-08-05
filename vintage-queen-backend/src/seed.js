import db from './db.js';
import { getConsignorTasks } from './asana.js';

// Asana has no concept of the short code used in Clover SKUs/tags, so it has
// to be maintained here, keyed by Asana task gid (not name - names get
// typo'd and reformatted). Verified against the real Clover categories/item
// names pulled from the live account, and confirmed with the shop.
const CODE_BY_TASK_GID = {
  '1212988852157040': 'TUCK',  // Tucker Wardwell (Clover: "Warwell, Tucker (Tuck)") - not yet seen in Clover data, confirmed by owner
  '1213886241341084': 'MAHER', // +Anothony/Cindy Maher (Clover: "Cindy Maher (Maher)") - not yet seen in Clover data, confirmed by owner
  '1214401019501119': 'ROX',   // Smith Estate/Roxanne (Clover: "Roxanne (Rox)") - not yet seen in Clover data, confirmed by owner
  '1214674428334824': 'KNOX',  // Cloris Knox (Clover: "(Knox)") - not yet seen in Clover data, confirmed by owner
  '1214751143479477': 'CHAMB', // Emily Chamberlin (Clover: "Chamberlin, Emily (Chamb)") - not yet seen in Clover data, confirmed by owner
  '1214879282511288': 'DOBB',  // Steve Dobbs (Clover: "Dobbs, Steve (Dobb)") - not yet seen in Clover data, confirmed by owner
  '1214879282511299': 'MONEY', // Steve Money (Clover: "(Money)") - not yet seen in Clover data, confirmed by owner
  '1215262766097009': 'PETE',  // Lisa Peterson (Clover: "(Pete)") - not yet seen in Clover data, confirmed by owner
  '1214550741378384': 'SUHA',  // Sue Harrison (Clover: "Susan Harrison (Suha)") - not yet seen in Clover data, confirmed by owner; do not confuse with SDAN (Sue Daniel, a different person)
  '1214466985331965': 'HEN',   // Ben Hendry
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
  '1216838570025494': 'ANTT',  // Antonia Tamayo
  '1216838570025470': 'PAT',   // Patrick Connor (Clover: "Patrick Connor (Pat)") - now has real July sales, confirmed active contract
  '1216838570025465': 'MJEN'   // Mitzi Jenson (Clover: "Jensen, Mitzi (Mjen)") - now has real July sales and contract dates, confirmed active
};

const insert = db.prepare(`
  INSERT INTO consignors (code, name, type, contract_start, contract_end, estate_sale_date, contact_email, contact_phone)
  VALUES (@code, @name, @type, @contract_start, @contract_end, @estate_sale_date, @contact_email, @contact_phone)
  ON CONFLICT(code) DO UPDATE SET
    name = excluded.name, type = excluded.type,
    contract_start = excluded.contract_start, contract_end = excluded.contract_end,
    estate_sale_date = excluded.estate_sale_date, contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone
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
      contact_email: t.email,
      contact_phone: t.phone
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
