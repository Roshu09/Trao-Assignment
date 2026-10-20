import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Validates external URLs before anything is fetched (brief, section 11). The application follows
 * links found on untrusted pages, so the guard also runs again on every redirect hop.
 */

export class UrlRejectedError extends Error {
  constructor(
    readonly reason: "INVALID_URL" | "BAD_PROTOCOL" | "CREDENTIALS" | "PRIVATE_ADDRESS" | "DNS_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "UrlRejectedError";
  }
}

export type HostLookup = (hostname: string) => Promise<string[]>;

const defaultLookup: HostLookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((r) => r.address);
};

export interface UrlGuardOptions {
  /** Allow localhost and private ranges. For local batch runs only, never in production. */
  allowPrivateHosts?: boolean;
  lookup?: HostLookup;
}

/** Returns the parsed URL if it is safe to fetch, otherwise throws UrlRejectedError. */
export async function assertSafeUrl(raw: string, options: UrlGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejectedError("INVALID_URL", `Not a valid URL: ${raw.slice(0, 100)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlRejectedError("BAD_PROTOCOL", `Only http and https are allowed, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UrlRejectedError("CREDENTIALS", "URLs with embedded credentials are not allowed");
  }
  if (options.allowPrivateHosts) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await (options.lookup ?? defaultLookup)(hostname);
    } catch {
      throw new UrlRejectedError("DNS_FAILED", `Could not resolve ${hostname}`);
    }
    if (addresses.length === 0) {
      throw new UrlRejectedError("DNS_FAILED", `Could not resolve ${hostname}`);
    }
  }

  // Every resolved address must be public, so a hostname cannot hide a private one among its records.
  const blocked = addresses.find((address) => isPrivateAddress(address));
  if (blocked) {
    throw new UrlRejectedError("PRIVATE_ADDRESS", `${hostname} resolves to a private address`);
  }
  return url;
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast and other non-public IPs. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPrivateIpv4(address);
  if (kind === 6) return isPrivateIpv6(address);
  return true; // not an IP at all: refuse rather than guess
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined) return true;

  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, includes cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // protocol assignments and documentation
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;

  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): judge the embedded IPv4 address.
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped?.[1]) {
    const tail = mapped[1];
    if (isIP(tail) === 4) return isPrivateIpv4(tail);
    const hextets = tail.split(":");
    if (hextets.length === 2) {
      const high = parseInt(hextets[0] ?? "", 16);
      const low = parseInt(hextets[1] ?? "", 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
    }
    return true;
  }

  const first = parseInt(lower.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 // multicast
  );
}
