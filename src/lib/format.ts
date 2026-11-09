export function formatPrice(value: number | string): string {
  const amount = typeof value === "string" ? Number(value) : value;

  if (amount === 0) {
    return "Free";
  }

  const hasCents = !Number.isInteger(amount);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatRelativeTime(iso: string): string {
  const diffSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absSeconds < 3600) {
    return formatter.format(Math.round(diffSeconds / 60), "minute");
  }

  if (absSeconds < 86400) {
    return formatter.format(Math.round(diffSeconds / 3600), "hour");
  }

  if (absSeconds < 2592000) {
    return formatter.format(Math.round(diffSeconds / 86400), "day");
  }

  if (absSeconds < 31536000) {
    return formatter.format(Math.round(diffSeconds / 2592000), "month");
  }

  return formatter.format(Math.round(diffSeconds / 31536000), "year");
}

export function formatLocation(location: string | null): string {
  const trimmed = location?.trim();
  return trimmed ? trimmed : "Palo Alto, CA";
}
