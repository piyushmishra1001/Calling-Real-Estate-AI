/**
 * Normalises a phone number to E.164. Indian numbers are the default:
 * "98765 43210", "09876543210", "+91-98765-43210" and "919876543210" all become "+919876543210".
 * Returns null when the number is not valid. Never guesses.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Spreadsheets sometimes turn long numbers into scientific notation (9.8765E+9): that data is already lost.
  if (/e[+-]?\d/i.test(s) && /^\d*\.?\d+e/i.test(s)) return null;

  s = s.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);

  if (s.startsWith("+")) {
    if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
    if (s.startsWith("+91")) return /^\+91[6-9]\d{9}$/.test(s) ? s : null;
    return s;
  }

  if (!/^\d+$/.test(s)) return null;
  s = s.replace(/^0+/, ""); // domestic trunk prefix
  if (/^91[6-9]\d{9}$/.test(s)) return "+" + s;
  if (/^[6-9]\d{9}$/.test(s)) return "+91" + s;
  return null;
}
