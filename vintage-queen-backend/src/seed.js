import db from './db.js';

// Replace with your real consignors, or build a small admin form later.
// type: 'estate' clients ran an estate sale and may still have storefront
// leftovers; 'direct' clients went straight to the storefront.
const consignors = [
  // { code: 'DM', name: 'Dolores M.', type: 'estate', contract_start: '2026-05-10', estate_sale_date: '2026-06-20' },
  // { code: 'FT', name: 'Frankie T.', type: 'direct', contract_start: '2026-03-01', estate_sale_date: null },
];

const insert = db.prepare(`
  INSERT INTO consignors (code, name, type, contract_start, estate_sale_date)
  VALUES (@code, @name, @type, @contract_start, @estate_sale_date)
  ON CONFLICT(code) DO UPDATE SET
    name = excluded.name, type = excluded.type,
    contract_start = excluded.contract_start, estate_sale_date = excluded.estate_sale_date
`);

for (const c of consignors) insert.run(c);
console.log(`Seeded ${consignors.length} consignors.`);
