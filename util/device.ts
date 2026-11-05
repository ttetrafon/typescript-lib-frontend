/**
 * A human-readable, repeatable label such as "Chrome on Windows · 3fa9".
 *
 * It is built from traits that rarely change (browser, OS, CPU cores, screen size, colour depth), so it stays the same across
 * visits and browser updates. It is only a label to help users recognise their sessions: it is not unique and not a
 * security control (the DPoP key is what identifies the device).
 */
export async function getDeviceLabel(): Promise<string> {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; brands?: { brand: string }[] } };
  const ua = nav.userAgent;

  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" : "Browser";

  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  const os =
    /android/i.test(ua) ? "Android" :
    /iphone|ipad|ios/i.test(ua) ? "iOS" :
    /win/i.test(platform) ? "Windows" :
    /mac/i.test(platform) ? "macOS" :
    /linux|x11/i.test(platform) ? "Linux" : "Unknown OS";

  const traits = [
    browser,
    os,
    nav.hardwareConcurrency ?? 0,
    Math.max(screen.width, screen.height), // orientation-independent
    Math.min(screen.width, screen.height),
    screen.colorDepth,
  ].join("|");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(traits));
  const short = Array.from(new Uint8Array(digest).slice(0, 2), b => b.toString(16).padStart(2, "0")).join("");

  return `${browser} on ${os} · ${short}`; // well under the server's 64 character limit
}
