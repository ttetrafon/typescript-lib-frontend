import { RequestMethod } from '../types';

export async function request<T>(url: string, method: RequestMethod, data: string | undefined, headers?: Record<string, string>): Promise<T> {
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
  });
  if (!res.ok) throw new Error(`Request at ${url} failed with code ${res.status}::${res.statusText}`);

  return (await res.json()) as T;
}

export async function requestGet<T>(url: string): Promise<T> {
  return await request(url, 'GET', undefined);
}

export async function requestPost<T>(url: string, data: string): Promise<T> {
  return await request(url, 'POST', data);
}
