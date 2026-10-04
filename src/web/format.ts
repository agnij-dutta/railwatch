export const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
const inrSmall = (n: number) => `₹${Math.abs(n).toFixed(2)}`;
/** Loss shown as "−₹x", gain as "+₹x". Sub-rupee amounts (network fees) keep paise so they don't read as free. */
export const inrSigned = (n: number) => {
  if (Math.abs(n) < 0.005) return "₹0";
  const body = Math.abs(n) < 1 ? inrSmall(n) : inr(n);
  return n < 0 ? `+${body}` : `−${body}`;
};
export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
export const bps = (n: number) => `${Math.round(n)} bps`;
export const rate = (n: number) => `₹${n.toFixed(2)}`;

export function stamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
