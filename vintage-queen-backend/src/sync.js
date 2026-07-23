import db from './db.js';
import { getOrdersSince, classifyOrderChannel } from './clover.js';

// The shop's own stock (not a real consignor) - Clover items/lines tagged
// "9000 ..." are house items and are always skipped.
const HOUSE_CODE = '9000';

// The consignor code is embedded directly in the Clover item/line-item name,
// with no consistent separator or casing, and two tagging conventions are in
// live use:
//   code-first: "Smc116 Vtg Collins Homestead Axe", "SDAN19 MISC", "ABARN NECKLACE"
//   code-last:  "Glass/wood Coffe Table Sdan104" (seen mainly on Sdan's furniture)
// Codes vary too much in length/case for a blind regex to disambiguate
// reliably, so match against the known consignors table instead - seed real
// consignors before running sync, or these lines are left unmatched for a
// manual look (same as any other genuinely unrecognized line item).
function knownConsignorCodes() {
  return db.prepare(`SELECT code FROM consignors`).all()
    .map(r => r.code)
    .filter(c => c !== HOUSE_CODE)
    .sort((a, b) => b.length - a.length); // longest first, e.g. "BENN" before "BEN"
}

function matchToken(token, codes) {
  const lower = token.toLowerCase();
  for (const code of codes) {
    if (!lower.startsWith(code.toLowerCase())) continue;
    const rest = token.slice(code.length);
    // after the code: nothing, a run of digits (item # / price point), or a
    // single letter (jewelry-type shorthand, e.g. "ABARN" -> ABAR + N)
    if (rest === '' || /^\d+$/.test(rest) || /^[A-Za-z]$/.test(rest)) {
      return code;
    }
  }
  return null;
}

function parseSku(text) {
  if (!text) return null;
  const tokens = text.trim().split(/\s+/);
  if (!tokens.length) return null;

  const codes = knownConsignorCodes();
  const code = matchToken(tokens[0], codes) || matchToken(tokens[tokens.length - 1], codes);
  if (!code) return null;

  return { code, isMisc: /misc/i.test(text) };
}

function getLastSyncTime() {
  const row = db.prepare(`SELECT value FROM sync_state WHERE key = 'last_sync_ms'`).get();
  return row ? Number(row.value) : 0;
}

function setLastSyncTime(ms) {
  db.prepare(`
    INSERT INTO sync_state (key, value) VALUES ('last_sync_ms', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(ms));
}

export async function runSync() {
  const since = getLastSyncTime();
  const orders = await getOrdersSince(since);
  let updated = 0;
  let unmatched = 0;
  let excluded = 0;

  for (const order of orders) {
    const channel = classifyOrderChannel(order);
    if (channel === 'excluded') {
      // One-off sale (e.g. a warehouse sale) that isn't consignor business -
      // don't attribute it to any consignor, don't count it toward either
      // channel's totals.
      excluded++;
      continue;
    }
    const soldStatus = channel === 'estate_sale' ? 'sold_estate' : 'sold_store';
    const soldDate = new Date(order.modifiedTime).toISOString().slice(0, 10);

    for (const line of order.lineItems?.elements || []) {
      const parsed = parseSku(line.name);
      if (!parsed) {
        unmatched++;
        continue; // unmatched line items need a manual look (unknown code, house stock, or a typo'd tag)
      }

      const existing = db.prepare(`
        SELECT * FROM items WHERE clover_line_item_id = ?
      `).get(line.id);

      if (existing) continue; // already recorded

      const price = line.price / 100;

      if (parsed.isMisc) {
        // Misc lots get grouped by consignor + price point + day - if today's
        // bucket already exists, bump the quantity instead of adding a new row.
        const bucket = db.prepare(`
          SELECT * FROM items
          WHERE consignor_code = ? AND is_misc = 1 AND tag_price = ? AND sold_date = ? AND channel = ?
        `).get(parsed.code, price, soldDate, channel);

        if (bucket) {
          db.prepare(`UPDATE items SET qty = qty + 1 WHERE id = ?`).run(bucket.id);
        } else {
          db.prepare(`
            INSERT INTO items (consignor_code, clover_order_id, clover_line_item_id, sku, title,
              category, tag_price, qty, is_misc, channel, status, sold_price, sold_date)
            VALUES (?, ?, ?, ?, 'Misc lot', 'Misc', ?, 1, 1, ?, ?, ?, ?)
          `).run(parsed.code, order.id, line.id, line.name, price, channel, soldStatus, price, soldDate);
        }
      } else {
        // Regular items are matched by consignor_code + sku against rows
        // already listed in the `items` table - there's no import step yet
        // that creates those rows from Clover inventory, so this currently
        // only affects items entered some other way (see README).
        db.prepare(`
          UPDATE items SET status = ?, sold_price = ?, sold_date = ?, clover_order_id = ?, clover_line_item_id = ?
          WHERE consignor_code = ? AND sku = ?
        `).run(soldStatus, price, soldDate, order.id, line.id, parsed.code, line.name);
      }
      updated++;
    }
  }

  setLastSyncTime(Date.now());
  console.log(`Sync complete: ${updated} line items processed from ${orders.length} orders, ${unmatched} unmatched, ${excluded} orders excluded (non-consignor sales).`);
}

// Run directly with `npm run sync`
if (import.meta.url === `file://${process.argv[1]}`) {
  runSync().catch(err => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });
}
