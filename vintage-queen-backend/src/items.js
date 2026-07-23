import db from './db.js';
import { getItems } from './clover.js';
import { parseSku } from './skuParser.js';

// Regular (non-misc) items need a row in the `items` table before sync.js
// can match a sale back to them - this pulls current Clover inventory and
// creates those rows. Misc lots are intentionally NOT pre-listed here: they
// have no individual identity in Clover until sold (sync.js creates/bumps
// their bucket row reactively at sale time), and pre-creating a zero-qty
// bucket per price point would just be dead rows.
//
// Channel/status at listing time is a best-effort default based on the
// consignor's type - estate clients' items are assumed estate-sale listings,
// direct clients' items are assumed storefront. This only matters before the
// item sells: sync.js sets both `status` and `channel` from the actual order
// at sale time, so a listing default being wrong (e.g. an estate leftover
// that sells at the storefront afterward) self-corrects once it sells.
function defaultListing(consignorType) {
  return consignorType === 'estate'
    ? { channel: 'estate_sale', status: 'estate_listed' }
    : { channel: 'storefront', status: 'in_stock' };
}

const insert = db.prepare(`
  INSERT INTO items (consignor_code, clover_item_id, sku, title, category, tag_price, qty, is_misc, channel, status)
  VALUES (@consignor_code, @clover_item_id, @sku, @title, @category, @tag_price, 1, 0, @channel, @status)
`);

export async function importItems() {
  const cloverItems = await getItems();
  let imported = 0, misc = 0, alreadyPresent = 0, unmatched = 0, deleted = 0;

  for (const item of cloverItems) {
    if (item.deleted) {
      deleted++;
      continue;
    }

    const parsed = parseSku(item.name);
    if (!parsed) {
      unmatched++;
      continue; // unknown code, house stock (9000), or a typo'd tag - needs a manual look
    }

    if (parsed.isMisc) {
      misc++;
      continue; // handled reactively by sync.js at sale time, not pre-listed
    }

    if (db.prepare(`SELECT 1 FROM items WHERE clover_item_id = ?`).get(item.id)) {
      alreadyPresent++;
      continue;
    }

    const consignor = db.prepare(`SELECT * FROM consignors WHERE code = ?`).get(parsed.code);
    if (!consignor) {
      // parseSku only matches codes already in the consignors table, so this
      // shouldn't happen in practice - guards against a code being removed
      // between the query in parseSku and here.
      unmatched++;
      continue;
    }

    const { channel, status } = defaultListing(consignor.type);

    insert.run({
      consignor_code: parsed.code,
      clover_item_id: item.id,
      sku: item.name,
      title: parsed.titleTokens.join(' ') || item.name,
      category: item.categories?.elements?.[0]?.name || null,
      tag_price: item.price / 100,
      channel,
      status
    });
    imported++;
  }

  console.log(`Item import complete: ${imported} imported, ${misc} misc (handled at sale time instead), ${alreadyPresent} already present, ${unmatched} unmatched, ${deleted} deleted Clover items skipped.`);
}

// Run directly with `npm run import-items`
if (import.meta.url === `file://${process.argv[1]}`) {
  importItems().catch(err => {
    console.error('Item import failed:', err.message);
    process.exit(1);
  });
}
