/**
 * Only same-site relative paths are allowed as post-login redirects. Rejects absolute URLs,
 * protocol-relative URLs ("//evil.com"), backslash tricks ("/\evil.com"), and control characters.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const u = new URL(next, "http://placeholder.invalid");
    if (u.host !== "placeholder.invalid") return fallback;
  } catch {
    return fallback;
  }
  return next;
}
