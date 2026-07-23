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
// use on almost every business day, while a handful of other devices each
// only show up for a day or two at a time - those map to one-off events:
//   - ESTATE_SALE_DEVICE_IDS: confirmed consignor estate sales (40% commission,
//     payout 7 days after the sale)
//   - EXCLUDED_DEVICE_IDS: one-off sales that use the same checkout style by
//     coincidence but aren't consignor business at all (e.g. warehouse sales) -
//     these orders are skipped entirely, not counted as estate or storefront
function deviceIdList(envVar) {
  return (process.env[envVar] || '').split(',').map(s => s.trim()).filter(Boolean);
}

const ESTATE_DEVICE_IDS = deviceIdList('ESTATE_SALE_DEVICE_IDS');
const EXCLUDED_DEVICE_IDS = deviceIdList('EXCLUDED_DEVICE_IDS');

export function classifyOrderChannel(order) {
  const deviceId = order.device?.id;
  if (EXCLUDED_DEVICE_IDS.includes(deviceId)) return 'excluded';
  if (ESTATE_DEVICE_IDS.includes(deviceId)) return 'estate_sale';
  return 'storefront';
}
