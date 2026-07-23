import db from './db.js';
import { getOrdersSince, classifyOrderChannel } from './clover.js';
import { parseSku } from './skuParser.js';

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
        // Regular items are matched against rows created by `npm run
        // import-items` (see items.js). Prefer the Clover item id - it's
        // stable even if the item's name/tag text was edited after listing.
        // Fall back to consignor_code + sku text for anything sold before
        // it was ever imported. Either way, set `channel` here (not just
        // `status`) - an item listed as an estate leftover that ends up
        // selling at the storefront needs its channel corrected to match
        // the sale, or it won't show up in *either* payout report (both
        // reports filter on channel AND status together).
        const itemId = line.item?.id;
        let result = { changes: 0 };
        if (itemId) {
          result = db.prepare(`
            UPDATE items SET status = ?, sold_price = ?, sold_date = ?, clover_order_id = ?, clover_line_item_id = ?, channel = ?
            WHERE clover_item_id = ?
          `).run(soldStatus, price, soldDate, order.id, line.id, channel, itemId);
        }
        if (result.changes === 0) {
          db.prepare(`
            UPDATE items SET status = ?, sold_price = ?, sold_date = ?, clover_order_id = ?, clover_line_item_id = ?, channel = ?
            WHERE consignor_code = ? AND sku = ?
          `).run(soldStatus, price, soldDate, order.id, line.id, channel, parsed.code, line.name);
        }
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
