import { createDpopProof } from '../security/dpop';
import { RequestMethod } from '../types/requests';

export async function request<T>(url: string, method: RequestMethod, data?: string, headers?: Record<string, string>, credentials?: RequestCredentials): Promise<T> {
  const h = new Headers();
  h.append('Content-Type', 'application/json');
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      h.append(key, value);
    }
  }

  const res: Response = await fetch(url, {
    method: method,
    body: data,
    headers: h,
    credentials,
  });
  if (!res.ok) throw new Error(`Request at ${url} failed with code ${res.status}::${res.statusText}`);

  return (await res.json()) as T;
}

export async function requestGet<T>(url: string, withAuth: boolean): Promise<T> {
  return withAuth
    ? await request<T>(url, 'GET', undefined, { DPoP: await createDpopProof('POST', url) }, 'include')
    : await request<T>(url, 'GET');
}

export async function requestPost<T>(url: string, data: string, withAuth: boolean): Promise<T> {
  return withAuth
    ? await request<T>(
      url,
      'POST',
      data,
      { DPoP: await createDpopProof('POST', url) },
      'include' // lets the browser store the HttpOnly refresh cookie from a cross-origin response
    )
    : await request<T>(url, 'POST', data);
}
