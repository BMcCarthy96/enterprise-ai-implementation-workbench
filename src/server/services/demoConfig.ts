/** Lightweight public-demo settings shared by routes and the admin service. */
export const DEMO_TTL_SECONDS = 60 * 60;
export const DEMO_ESTIMATED_RESERVATION_USD = 0.05;

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}
