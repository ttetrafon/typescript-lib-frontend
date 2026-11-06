import { createDpopProof } from '../security/dpop';
import { RequestMethod } from '../types/requests';

const DPOP_NONCE_HEADER = 'DPoP-Nonce';
const USE_DPOP_NONCE = 'use_dpop_nonce'; // RFC 9449 §8: the server wants a proof carrying its (new) nonce

/** The newest server nonce per origin. Every response from a nonce-issuing endpoint carries a fresh one. */
const nonces = new Map<string, string>();

async function send(url: string, method: RequestMethod, data?: string, headers?: Record<string, string>, credentials?: RequestCredentials): Promise<Response> {
  const h = new Headers();
  h.append('Content-Type', 'application/json');
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      h.append(key, value);
    }
  }

  return await fetch(url, {
    method: method,
    body: data,
    headers: h,
    credentials,
  });
}

export async function request<T>(url: string, method: RequestMethod, data?: string, headers?: Record<string, string>, credentials?: RequestCredentials): Promise<T> {
  const res = await send(url, method, data, headers, credentials);
  if (!res.ok) throw new Error(`Request at ${url} failed with code ${res.status}::${res.statusText}`);
  return (await res.json()) as T;
}

async function isNonceChallenge(res: Response): Promise<boolean> {
  try {
    return ((await res.clone().json()) as { error?: string }).error === USE_DPOP_NONCE;
  } catch {
    return false;
  }
}

/**
 * A request signed with a DPoP proof. Remembers the server's nonce, and when the server answers `use_dpop_nonce`
 * (first request, or the nonce expired) signs again with the nonce it sent and retries once.
 */
async function dpopRequest<T>(url: string, method: RequestMethod, data?: string): Promise<T> {
  const origin = new URL(url).origin;

  for (let attempt = 0; ; attempt++) {
    const proof = await createDpopProof(method, url, undefined, nonces.get(origin));
    // 'include' lets the browser store/send the HttpOnly refresh cookie on cross-origin calls
    const res = await send(url, method, data, { DPoP: proof }, 'include');

    // Needs the server to expose the header via CORS (Access-Control-Expose-Headers)
    const fresh = res.headers.get(DPOP_NONCE_HEADER);
    if (fresh) nonces.set(origin, fresh);

    if (res.ok) return (await res.json()) as T;
    if (attempt === 0 && fresh && await isNonceChallenge(res)) continue;
    throw new Error(`Request at ${url} failed with code ${res.status}::${res.statusText}`);
  }
}

export async function requestGet<T>(url: string, withAuth: boolean): Promise<T> {
  return withAuth
    ? await dpopRequest<T>(url, 'GET')
    : await request<T>(url, 'GET');
}

export async function requestPost<T>(url: string, data: string, withAuth: boolean): Promise<T> {
  return withAuth
    ? await dpopRequest<T>(url, 'POST', data)
    : await request<T>(url, 'POST', data);
}
