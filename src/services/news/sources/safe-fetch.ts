import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const MAX_BYTES = 3_000_000;

export async function safeFetchText(
  input: string,
  options: { allowedHosts?: string[]; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ text: string; finalUrl: string; contentType: string }> {
  let current = new URL(input);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? MAX_BYTES;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicHttpUrl(current, options.allowedHosts);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,application/json;q=0.8",
        "User-Agent": "LangousteNews/1.0 (+integrated language-learning reader)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect from ${current.hostname} had no location`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok)
      throw new Error(`Could not fetch ${current.hostname}: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Response from ${current.hostname} is larger than ${maxBytes} bytes`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Response from ${current.hostname} is larger than ${maxBytes} bytes`);
    }
    return {
      text,
      finalUrl: response.url || current.toString(),
      contentType: response.headers.get("content-type") ?? "",
    };
  }
  throw new Error(`Too many redirects while fetching ${input}`);
}

export async function assertPublicHttpUrl(url: URL, allowedHosts?: string[]): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be scraped");
  }
  const hostname = url.hostname.toLocaleLowerCase("en").replace(/\.$/u, "");
  if (
    allowedHosts &&
    !allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))
  ) {
    throw new Error(`Host ${hostname} is not supported by this source`);
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Private network URLs cannot be scraped");
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Private network URLs cannot be scraped");
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Host resolves to a private or unavailable network address");
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase("en");
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/u.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : null);
  if (!ipv4) return false;
  const [a = 0, b = 0] = ipv4.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
