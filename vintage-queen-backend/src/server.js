import express from 'express';
import 'dotenv/config';
import db from './db.js';
import { startScheduledJobs } from './reports.js';

const app = express();
app.use(express.json());

const COMMISSION = { estate_sale: 0.40, storefront: 0.50 };

function payoutFor(item) {
  const commission = COMMISSION[item.channel];
  const gross = item.is_misc ? item.tag_price * item.qty : item.sold_price;
  return gross * (1 - commission);
}

// Everything a consignor sees in their portal, in one call.
app.get('/api/consignors/:code/dashboard', (req, res) => {
  const consignor = db.prepare(`SELECT * FROM consignors WHERE code = ?`).get(req.params.code);
  if (!consignor) return res.status(404).json({ error: 'Consignor not found' });

  const items = db.prepare(`SELECT * FROM items WHERE consignor_code = ? ORDER BY updated_at DESC`).all(consignor.code);

  const sold = items.filter(i => i.status === 'sold_estate' || i.status === 'sold_store');
  const active = items.filter(i => i.status === 'estate_listed' || i.status === 'in_stock');
  const owedEstate = sold.filter(i => i.channel === 'estate_sale').reduce((s, i) => s + payoutFor(i), 0);
  const owedStore = sold.filter(i => i.channel === 'storefront').reduce((s, i) => s + payoutFor(i), 0);

  res.json({
    consignor,
    items,
    summary: {
      activeCount: active.length,
      soldCount: sold.length,
      owedEstate,
      owedStore,
      owedTotal: owedEstate + owedStore
    }
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Vintage Queen backend running on port ${port}`);
  startScheduledJobs();
});
