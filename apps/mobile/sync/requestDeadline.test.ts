import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithDeadline,
  REQUEST_TIMEOUT_MESSAGE,
  requestTimeoutMs,
  STORAGE_REQUEST_TIMEOUT_MS,
} from './requestDeadline';
import { classifyRequestFailure } from './requestFailure';

const URL_ORIGIN = 'https://project.supabase.co';

/** A transport that never answers: what a socket caught by a network change does. */
function hangingFetch(): { fetch: typeof fetch; seen: () => AbortSignal | undefined } {
  let signal: AbortSignal | undefined;
  const impl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => undefined);
  });
  return { fetch: impl as unknown as typeof fetch, seen: () => signal };
}

/** A transport that honours abort the way whatwg-fetch does. */
function abortableFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchWithDeadline', () => {
  it('returns the response and leaves no timer behind', async () => {
    const response = new Response('ok');
    const impl = vi.fn(async () => response) as unknown as typeof fetch;

    await expect(fetchWithDeadline(impl, `${URL_ORIGIN}/rest/v1/x`, {}, 1_000)).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails a request that never answers at the deadline, and aborts it', async () => {
    const transport = hangingFetch();
    const pending = fetchWithDeadline(transport.fetch, `${URL_ORIGIN}/auth/v1/token`, {}, 20_000);
    const outcome = pending.then(() => 'resolved', (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(transport.seen()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = await outcome;
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(REQUEST_TIMEOUT_MESSAGE);
    expect(transport.seen()?.aborted).toBe(true);
  });

  it('still fails at the deadline when the transport ignores the abort', async () => {
    // hangingFetch never settles, even after its signal aborts.
    const transport = hangingFetch();
    const outcome = fetchWithDeadline(transport.fetch, `${URL_ORIGIN}/functions/v1/sync`, {}, 5_000)
      .then(() => 'resolved', (error: unknown) => (error as Error).message);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(outcome).resolves.toBe(REQUEST_TIMEOUT_MESSAGE);
  });

  it('forwards the caller abort and rethrows the caller error unchanged', async () => {
    const caller = new AbortController();
    const outcome = fetchWithDeadline(abortableFetch(), `${URL_ORIGIN}/functions/v1/sync`, { signal: caller.signal }, 60_000)
      .then(() => 'resolved', (error: unknown) => error);

    caller.abort();

    const error = await outcome;
    expect((error as Error).name).toBe('AbortError');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets the caller still cancel after the response arrives', async () => {
    const caller = new AbortController();
    let forwarded: AbortSignal | undefined;
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      forwarded = init?.signal ?? undefined;
      return new Response('ok');
    }) as unknown as typeof fetch;

    await fetchWithDeadline(impl, `${URL_ORIGIN}/functions/v1/sync`, { signal: caller.signal }, 60_000);
    caller.abort();

    expect(forwarded?.aborted).toBe(true);
  });

  it('starts aborted when the caller signal already is', async () => {
    const caller = new AbortController();
    caller.abort();
    const transport = hangingFetch();

    void fetchWithDeadline(transport.fetch, `${URL_ORIGIN}/rest/v1/x`, { signal: caller.signal }, 60_000).catch(() => undefined);
    await Promise.resolve();

    expect(transport.seen()?.aborted).toBe(true);
  });

  it('passes the rest of the request through untouched', async () => {
    const impl = vi.fn(async () => new Response('ok'));
    const headers = { authorization: 'Bearer token' };

    await fetchWithDeadline(impl as unknown as typeof fetch, `${URL_ORIGIN}/rest/v1/x`, { method: 'POST', headers, redirect: 'error' }, 1_000);

    const [, sent] = impl.mock.calls[0] as unknown as [string, RequestInit];
    expect(sent.method).toBe('POST');
    expect(sent.headers).toBe(headers);
    expect(sent.redirect).toBe('error');
    expect(sent.signal).toBeInstanceOf(AbortSignal);
  });

  it('times out with an error the sync classifier reads as a transport failure', () => {
    expect(classifyRequestFailure(new TypeError(REQUEST_TIMEOUT_MESSAGE))).toBe('offline');
  });
});

describe('requestTimeoutMs', () => {
  it.each([
    [`${URL_ORIGIN}/auth/v1/token?grant_type=refresh_token`, AUTH_REQUEST_TIMEOUT_MS],
    [`${URL_ORIGIN}/storage/v1/object/prescriptions/a.jpg`, STORAGE_REQUEST_TIMEOUT_MS],
    [`${URL_ORIGIN}/functions/v1/sync`, DEFAULT_REQUEST_TIMEOUT_MS],
    [`${URL_ORIGIN}/rest/v1/shops`, DEFAULT_REQUEST_TIMEOUT_MS],
    ['not a url', DEFAULT_REQUEST_TIMEOUT_MS],
  ])('%s -> %i ms', (url, expected) => {
    expect(requestTimeoutMs(url)).toBe(expected);
  });
});
