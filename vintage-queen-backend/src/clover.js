import 'dotenv/config';

const BASE = process.env.CLOVER_API_BASE;
const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;
const TOKEN = process.env.CLOVER_ACCESS_TOKEN;

async function cloverGet(path, params = {}) {
  const url = new URL(`${BASE}/v3/merchants/${MERCHANT_ID}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Clover API error ${res.status}: ${body}`);
  }
  return res.json();
}

// Pulls all inventory items (used to see SKUs and current price/stock)
export async function getItems() {
  const data = await cloverGet('/items', { expand: 'categories', limit: 1000 });
  return data.elements || [];
}

// Pulls orders modified since a given timestamp (ms), with line items expanded.
// Clover's `filter=modifiedTime>=X` catches new sales without re-scanning everything.
export async function getOrdersSince(sinceMs) {
  const data = await cloverGet('/orders', {
    expand: 'lineItems',
    filter: `modifiedTime>=${sinceMs}`,
    limit: 1000
  });
  return data.elements || [];
}

// Clover order objects don't carry a native "which register/location" flag,
// but real order history shows the storefront register (one device.id) in
// use on almost every business day, while estate sales run on a separate
// device that only shows up for the day or two of that specific sale. List
// those estate-sale device ids in ESTATE_SALE_DEVICE_IDS (comma-separated)
// once confirmed - see .env.example for the candidates found so far.
const ESTATE_DEVICE_IDS = (process.env.ESTATE_SALE_DEVICE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export function isEstateSaleOrder(order) {
  return ESTATE_DEVICE_IDS.includes(order.device?.id);
}
