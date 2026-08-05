import db from './db.js';

// The shop's own stock (not a real consignor) - Clover items/lines tagged
// "9000 ..." are house items and are always skipped.
export const HOUSE_CODE = '9000';

// Some consignors end up with more than one Clover-side code because staff
// tagged their items inconsistently over time. Rather than a duplicate
// consignor row per alias, map the alias straight through to the real
// (canonical) code already in the consignors table. Confirmed: Rod Ruter's
// items are tagged with both "RUTER" and "RR".
const CODE_ALIASES = {
  RR: 'RUTER'
};

// The consignor code is embedded directly in the Clover item/line-item name,
// with no consistent separator or casing, and two tagging conventions are in
// live use:
//   code-first: "Smc116 Vtg Collins Homestead Axe", "SDAN19 MISC", "ABARN NECKLACE"
//   code-last:  "Glass/wood Coffe Table Sdan104" (seen mainly on Sdan's furniture)
// Codes vary too much in length/case for a blind regex to disambiguate
// reliably, so match against the known consignors table (plus any aliases)
// instead - seed real consignors before running import/sync, or these lines
// are left unmatched for a manual look.
function knownConsignorCodes() {
  const codes = db.prepare(`SELECT code FROM consignors`).all()
    .map(r => r.code)
    .filter(c => c !== HOUSE_CODE);
  return [...new Set([...codes, ...Object.keys(CODE_ALIASES)])]
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
      return CODE_ALIASES[code] || code;
    }
  }
  return null;
}

// Returns { code, isMisc, titleTokens } - titleTokens is what's left of the
// name once the matched code token is removed, useful for deriving a clean
// item title when importing from Clover inventory.
export function parseSku(text) {
  if (!text) return null;
  const tokens = text.trim().split(/\s+/);
  if (!tokens.length) return null;

  const codes = knownConsignorCodes();
  const isMisc = /misc/i.test(text);

  const firstCode = matchToken(tokens[0], codes);
  if (firstCode) return { code: firstCode, isMisc, titleTokens: tokens.slice(1) };

  const lastCode = matchToken(tokens[tokens.length - 1], codes);
  if (lastCode) return { code: lastCode, isMisc, titleTokens: tokens.slice(0, -1) };

  return null;
}
