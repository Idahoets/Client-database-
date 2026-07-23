import Database from 'better-sqlite3';
import 'dotenv/config';

const db = new Database(process.env.DB_PATH || './vintage-queen.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS consignors (
  code TEXT PRIMARY KEY,          -- short code used in SKUs, e.g. 'DM'
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'estate' or 'direct'
  contract_start TEXT NOT NULL,   -- ISO date, storefront contract begins
  contract_end TEXT NOT NULL,     -- ISO date, real contract end (not always exactly +90 days - store the real date, don't compute it)
  estate_sale_date TEXT,          -- ISO date, only set for type='estate'
  contact_email TEXT,
  contact_phone TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignor_code TEXT NOT NULL REFERENCES consignors(code),
  clover_item_id TEXT,            -- Clover inventory item id, if it has one
  clover_order_id TEXT,           -- Clover order id, once sold
  clover_line_item_id TEXT,
  sku TEXT,                       -- e.g. 'DM-0042' or 'hask8 misc'
  title TEXT NOT NULL,
  category TEXT,
  tag_price REAL NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1, -- >1 only for misc bucket lines
  is_misc INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL,          -- 'estate_sale' or 'storefront'
  status TEXT NOT NULL,           -- 'estate_listed' | 'sold_estate' | 'in_stock' | 'sold_store'
  sold_price REAL,
  sold_date TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignor_code TEXT NOT NULL REFERENCES consignors(code),
  report_type TEXT NOT NULL,      -- 'estate_payout' or 'storefront_statement'
  amount REAL NOT NULL,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  details_json TEXT
);
`);

export default db;
