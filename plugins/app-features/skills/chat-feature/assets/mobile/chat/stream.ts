/**
 * A run as an async iterable of events, over an authenticated streaming POST.
 *
 * `expo/fetch`, imported explicitly. React Native's own fetch is XHR-based and
 * has no `response.body`: `getReader()` is undefined there, so a stream built on
 * it passes every test and does nothing on a phone. Recent Expo SDKs install
 * `expo/fetch` as the global fetch, but an explicit import works on every SDK
 * and survives `EXPO_PUBLIC_USE_RN_FETCH=1`.
 */
import { createSseDecoder, isTerminal, type AgentEvent } from './protocol';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;

let expoFetch: Promise<FetchLike> | null = null;
/** Lazy, so unit tests in plain Node never load `expo/fetch`. */
const platformFetch = () => (expoFetch ??= import('expo/fetch').then((m) => m.fetch as unknown as FetchLike));

/** A refusal before the stream opened: a status plus the server's `{ code, message }`. */
export class StreamRefused extends Error {
  constructor(readonly status: number, readonly code?: string, readonly detail?: string) {
    super(`Stream refused with ${status}`);
  }
}

export interface OpenOptions {
  baseUrl: string;
  path: string;
  body: unknown;
  /** Your auth: the current access token, and a refresh that returns true on success. */
  token: () => Promise<string | null>;
  refresh?: () => Promise<boolean>;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

export async function openStream(o: OpenOptions): Promise<ReadableStream<Uint8Array>> {
  const doFetch = o.fetchImpl ?? (await platformFetch());
  // Serialised ONCE, so the single 401 retry below sends the same bytes.
  const payload = JSON.stringify(o.body);

  const open = async () => {
    const token = await o.token();
    return doFetch(`${o.baseUrl}${o.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
      signal: o.signal,
    });
  };

  let response = await open();
  // A token that expired over the weekend must not make the chat silently unavailable.
  if (response.status === 401 && o.refresh && (await o.refresh())) response = await open();

  if (!response.ok) {
    const { code, message } = await readRefusal(response.body);
    throw new StreamRefused(response.status, code, message);
  }
  if (!response.body) throw new Error('This fetch has no streaming body. Import fetch from expo/fetch.');
  return response.body;
}

/** Bounded: a proxy answering 402 with a megabyte of HTML must not be held in memory. */
async function readRefusal(body: ReadableStream<Uint8Array> | null): Promise<{ code?: string; message?: string }> {
  if (!body) return {};
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const parsed = JSON.parse(text);
    return {
      code: typeof parsed?.code === 'string' ? parsed.code : undefined,
      message: typeof parsed?.message === 'string' ? parsed.message : undefined,
    };
  } catch {
    return {};
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Bytes to events. Stops at the first terminal event. The `finally` cancels
 * the reader on EVERY exit, including when the consumer breaks out of its
 * `for await`, which is how Stop works. Without it the socket stays open and
 * the model keeps generating into nothing.
 */
export async function* decodeStream(source: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = source.getReader();
  const decoder = createSseDecoder();
  // `stream: true` keeps a multi-byte character split across two reads intact.
  const text = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of decoder.push(text.decode(value, { stream: true }))) {
        yield event;
        if (isTerminal(event)) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function* runAgent(o: OpenOptions): AsyncGenerator<AgentEvent> {
  yield* decodeStream(await openStream(o));
}
