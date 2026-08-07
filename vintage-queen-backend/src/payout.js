import db from './db.js';

export const COMMISSION = { estate_sale: 0.40, storefront: 0.50 };

export function payoutFor(item) {
  const commission = COMMISSION[item.channel];
  const gross = item.is_misc ? item.tag_price * item.qty : item.sold_price;
  return gross * (1 - commission);
}

// Shared by the JSON API (server.js) and the HTML portal page (portal.js) so
// the two never drift - "owed" only counts sales not yet claimed by a
// report (see reports.js's reported_in_report_id), reportedTotal is the
// lifetime paid/reported figure, kept separate.
export function getDashboardData(code) {
  const consignor = db.prepare(`SELECT * FROM consignors WHERE code = ?`).get(code);
  if (!consignor) return null;

  const items = db.prepare(`SELECT * FROM items WHERE consignor_code = ? ORDER BY updated_at DESC`).all(code);
  const sold = items.filter(i => i.status === 'sold_estate' || i.status === 'sold_store');
  const active = items.filter(i => i.status === 'estate_listed' || i.status === 'in_stock');
  const unreported = sold.filter(i => i.reported_in_report_id === null);
  const reported = sold.filter(i => i.reported_in_report_id !== null);
  const owedEstate = unreported.filter(i => i.channel === 'estate_sale').reduce((s, i) => s + payoutFor(i), 0);
  const owedStore = unreported.filter(i => i.channel === 'storefront').reduce((s, i) => s + payoutFor(i), 0);
  const reportedTotal = reported.reduce((s, i) => s + payoutFor(i), 0);

  const { portal_pin, ...consignorSafe } = consignor;

  return {
    consignor: consignorSafe,
    items,
    summary: {
      activeCount: active.length,
      soldCount: sold.length,
      owedEstate,
      owedStore,
      owedTotal: owedEstate + owedStore,
      reportedTotal
    }
  };
}
