export const inr = (n: number | string | null | undefined, digits = 2) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const num = (n: number | string | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));

export const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

export const dt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export const isPast = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() < Date.now() : false);

export const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
