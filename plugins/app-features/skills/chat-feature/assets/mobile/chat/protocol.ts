/**
 * What the server can say while the agent runs. The twin of AgentEvents.cs
 * (agent-harness). Keep a test on each side that lists every event type.
 *
 * Typed events rather than a token stream with markers like `[Tool:x]` in the
 * prose. Markers break when a network chunk splits one, need stripping at every
 * render site, collide with anything the model quotes, and make the MODEL
 * responsible for emitting UI.
 */

export type AgentErrorCode =
  | 'unauthorized'
  | 'rateLimited'
  | 'providerError'
  | 'timeout'
  | 'connectionLost'
  | 'unknown'
  /** No subscription: open the paywall instead of showing a message. */
  | 'entitlementRequired'
  /** The month's budget is spent. The server's message names the reset date. */
  | 'budgetExhausted'
  /** The person has not agreed to share data with the AI provider. */
  | 'consentRequired';

const ERROR_CODES: readonly AgentErrorCode[] = [
  'unauthorized', 'rateLimited', 'providerError', 'timeout', 'connectionLost', 'unknown',
  'entitlementRequired', 'budgetExhausted', 'consentRequired',
];

export const isErrorCode = (v: unknown): v is AgentErrorCode =>
  typeof v === 'string' && ERROR_CODES.includes(v as AgentErrorCode);

/** Your app's write targets. An unknown target is DROPPED, never defaulted. */
export type ProposalTarget = 'item';
const PROPOSAL_TARGETS: readonly ProposalTarget[] = ['item'];

export type FinishReason = 'stop' | 'length' | 'toolLimit';

export type AgentEvent =
  | { type: 'runStarted'; runId: string }
  | { type: 'textStart'; messageId: string }
  | { type: 'textDelta'; messageId: string; delta: string }
  | { type: 'textEnd'; messageId: string }
  | { type: 'toolStart'; callId: string; name: string }
  | { type: 'toolResult'; callId: string; summary: string; failed: boolean }
  | { type: 'proposal'; proposalId: string; target: ProposalTarget; commands: unknown[] }
  | { type: 'runFinished'; runId: string; reason: FinishReason }
  | { type: 'runError'; code: AgentErrorCode; message: string };

export const isTerminal = (e: AgentEvent) => e.type === 'runFinished' || e.type === 'runError';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';

/**
 * One JSON payload to one event, or null. Unknown types are DROPPED, not
 * thrown: a newer server must not crash an older app still in the store.
 */
export function parseEvent(payload: string): AgentEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !str(raw.type)) return null;

  switch (raw.type) {
    case 'runStarted':
      return str(raw.runId) ? { type: 'runStarted', runId: raw.runId } : null;
    case 'textStart':
    case 'textEnd':
      return str(raw.messageId) ? { type: raw.type, messageId: raw.messageId } : null;
    case 'textDelta':
      return str(raw.messageId) && str(raw.delta) ? { type: 'textDelta', messageId: raw.messageId, delta: raw.delta } : null;
    case 'toolStart':
      return str(raw.callId) && str(raw.name) ? { type: 'toolStart', callId: raw.callId, name: raw.name } : null;
    case 'toolResult':
      return str(raw.callId) && str(raw.summary)
        ? { type: 'toolResult', callId: raw.callId, summary: raw.summary, failed: raw.failed === true }
        : null;
    case 'proposal':
      if (!str(raw.proposalId) || !Array.isArray(raw.commands)) return null;
      if (!PROPOSAL_TARGETS.includes(raw.target as ProposalTarget)) return null;
      return { type: 'proposal', proposalId: raw.proposalId, target: raw.target as ProposalTarget, commands: raw.commands };
    case 'runFinished': {
      if (!str(raw.runId)) return null;
      const reason: FinishReason = raw.reason === 'length' || raw.reason === 'toolLimit' ? raw.reason : 'stop';
      return { type: 'runFinished', runId: raw.runId, reason };
    }
    case 'runError':
      // An unknown code is still an error worth showing: keep the message.
      return str(raw.message)
        ? { type: 'runError', code: isErrorCode(raw.code) ? raw.code : 'unknown', message: raw.message }
        : null;
    default:
      return null;
  }
}

/**
 * Server-sent events across arbitrary chunk boundaries.
 *
 * A network chunk has nothing to do with an event boundary:
 * `{"type":"textDe` then `lta",…}\n\n` is a normal pair of reads. Anything that
 * parses a chunk alone breaks only under load, on a real connection, sometimes.
 * So: append, then take only whole events.
 */
export function createSseDecoder() {
  let buffer = '';
  return {
    push(chunk: string): AgentEvent[] {
      // SSE allows \r\n and \r. A search for \n\n alone never fires on a server that uses them.
      buffer += chunk.replace(/\r\n|\r/g, '\n');
      const events: AgentEvent[] = [];
      let at = buffer.indexOf('\n\n');
      while (at !== -1) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const event = decodeBlock(block);
        if (event) events.push(event);
        at = buffer.indexOf('\n\n');
      }
      return events;
    },
  };
}

/** Only `data:` lines are read. Lines starting with `:` are comments (keep-alives). */
function decodeBlock(block: string): AgentEvent | null {
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5);
    data.push(value.startsWith(' ') ? value.slice(1) : value);
  }
  return data.length ? parseEvent(data.join('\n')) : null;
}
