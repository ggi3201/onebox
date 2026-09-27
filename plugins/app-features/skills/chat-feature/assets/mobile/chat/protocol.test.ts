/**
 * The decoder must survive any chunking. These run in plain Node (vitest or
 * jest); no fetch, no phone.
 */
import { describe, expect, it } from 'vitest';

import { createSseDecoder, parseEvent, type AgentEvent } from './protocol';
import { decodeStream } from './stream';

const frames = [
  ': keep-alive\n\n',
  'data: {"type":"runStarted","runId":"r"}\n\n',
  'data: {"type":"textStart","messageId":"m"}\n\n',
  'data: {"type":"textDelta","messageId":"m","delta":"Grüße "}\n\n',
  'data: {"type":"textDelta","messageId":"m","delta":"👋"}\n\n',
  'data: {"type":"textEnd","messageId":"m"}\n\n',
  'data: {"type":"runFinished","runId":"r","reason":"stop"}\n\n',
].join('');

function streamOf(bytes: Uint8Array, cut: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += cut) c.enqueue(bytes.slice(i, i + cut));
      c.close();
    },
  });
}

describe('decoder', () => {
  it('gives the same events for every chunk size, including splits inside UTF-8', async () => {
    const bytes = new TextEncoder().encode(frames);
    const expected: AgentEvent[] = [];
    for await (const e of decodeStream(streamOf(bytes, bytes.length))) expected.push(e);
    expect(expected).toHaveLength(6);

    for (let cut = 1; cut <= 17; cut++) {
      const got: AgentEvent[] = [];
      for await (const e of decodeStream(streamOf(bytes, cut))) got.push(e);
      expect(got).toEqual(expected);
    }
  });

  it('accepts \\r\\n line endings', () => {
    const d = createSseDecoder();
    expect(d.push('data: {"type":"runStarted","runId":"r"}\r\n\r\n')).toHaveLength(1);
  });

  it('drops unknown event types and unknown proposal targets instead of throwing', () => {
    expect(parseEvent('{"type":"somethingNew"}')).toBeNull();
    expect(parseEvent('{"type":"proposal","proposalId":"p","target":"elsewhere","commands":[]}')).toBeNull();
    expect(parseEvent('not json')).toBeNull();
  });

  it('keeps the message of an error with an unknown code', () => {
    expect(parseEvent('{"type":"runError","code":"brandNew","message":"hm"}')).toEqual({ type: 'runError', code: 'unknown', message: 'hm' });
  });
});
