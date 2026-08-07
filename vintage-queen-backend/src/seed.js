import db from './db.js';
import { getConsignorTasks } from './asana.js';
import { ensurePortalPins } from './portal.js';
import { sendPortalAccessEmail } from './notify.js';

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
  '1216838570025465': 'MJEN',  // Mitzi Jenson (Clover: "Jensen, Mitzi (Mjen)") - now has real July sales and contract dates, confirmed active
  // Owner filled in contract dates in Asana for these 8 - previously blocked
  // on missing contract_start/due_on entirely:
  '1213204665803835': 'ABAR',  // Allari, Barbara - Jenny Horning contact (Clover: "Allari Barbara (Abar)")
  '1213890005166781': 'PRICE', // Brian Price (Clover: "PRICE, BRIAN (PRICE)")
  '1213160677847044': 'PIP',   // Fesjian, Pippa (Clover: "Pippa Fesjian (Pip)")
  '1213890005155409': 'WEST',  // Herb Wescott (Clover: "WESCOTT, HERB (WEST)")
  '1212596660527294': 'BB',    // Britton, Brian (Clover: "Britton, Brian (BB)")
  '1213890005155385': 'JIMM',  // Jim Moore (Clover: "MOORE, JIM (JIMM)")
  '1212903565511041': 'WOOD',  // Greg Woods (Clover: "Woods, Greg (Wood)")
  '1213204890649682': 'LARR',  // Larrondo, Dana (Clover: "Dana Larrondo (Larr)")
  '1217197908391185': 'GFA',   // Greg Fairbourn - brand new Asana task, complete from the start (Clover: "Fairbourn, Greg (Gfa)")
  '1217197908391196': 'THAN'   // Tania Hansen - contract dates filled in 8/4 (Clover: "Hansen, Tania", items tagged "Than...")
};

// Two different people are tagged with the exact same code "WOOD" in Clover
// - Greg Woods (mapped above, items "Wood22 Drexel Dresser" etc, contract
// dates on file) and Sherri Wood (category "WOOD SHERRI (WOOD)", items
// "WOOD5 MISC" etc, no contract dates yet). Real collision, not a typo -
// there's no way to tell their sales apart by code alone. Do NOT map Sherri
// Wood under "WOOD" once she has contract dates - she needs a distinct code
// (e.g. "SWOOD") assigned in Clover going forward, and someone should look
// at whether her historical "WOOD..." sales can be told apart from Greg's
// by item-number range (his cluster in the 20s, hers in 1-5) before trusting
// any past totals under this code.

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

  const newPins = ensurePortalPins();
  for (const c of newPins) {
    await sendPortalAccessEmail(c);
  }

  console.log(`Seeded ${seeded} consignors from Asana. ${noCode} skipped (no Clover code mapped), ${incomplete} skipped (missing contract dates), ${flagged.length} possible duplicates flagged above. ${newPins.length} portal PIN(s) generated and emailed.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFromAsana().catch(err => {
    console.error('Seed from Asana failed:', err.message);
    process.exit(1);
  });
}

export default seedFromAsana;
