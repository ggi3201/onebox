/**
 * The conversation. Every event is handled in ONE exhaustive switch, because
 * the stream has a type: a new event kind is a compile error here, not a
 * silent no-op.
 *
 * Not persisted by default. Most assistant chats are about what is on screen
 * now; add persistence only if your users ask to come back to a thread.
 */
import { create } from 'zustand';

import type { Attachment } from './attach';
import { chatConfig } from './config';
import { isErrorCode, isTerminal, type AgentErrorCode, type AgentEvent, type FinishReason, type ProposalTarget } from './protocol';
import { runAgent, StreamRefused } from './stream';

/** What the screen is showing, sent so the server can say "where they are". Mirror of ViewContext.cs. */
export type ViewContext = { kind: 'home' } | { kind: 'item'; itemId: string } | { kind: 'none' };

/**
 * Turns sent to the server. Below the server's MaxMessages (40) with room to
 * spare. Without a cap, a long chat starts failing with 400 after about twenty
 * exchanges, and nothing on screen says why.
 */
const MAX_HISTORY = 24;

export interface ToolActivity { callId: string; name: string; summary?: string; failed?: boolean }

export interface Proposal {
  id: string;
  target: ProposalTarget;
  commands: unknown[];
  /** Set once decided. A decided card stays on screen, disabled. */
  outcome?: 'applied' | 'dismissed' | 'failed';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming: boolean;
  tools: ToolActivity[];
  proposals: Proposal[];
  /** Local uri of a photo the person attached, for the thumbnail. */
  image?: string;
  /** Why the answer ended, when it did not end normally. */
  cut?: Exclude<FinishReason, 'stop'>;
}

interface ChatState {
  messages: Message[];
  running: boolean;
  error: { code: AgentErrorCode; message: string } | null;
  send: (text: string, view: ViewContext, attachment?: Attachment) => Promise<void>;
  stop: () => void;
  reset: () => void;
  applyProposal: (id: string) => Promise<void>;
  dismissProposal: (id: string) => void;
}

/**
 * The run in flight. Module-level, not store state: aborting is an act on one
 * request, and a controller in the store re-renders every subscriber.
 */
let inFlight: AbortController | null = null;

const blank = (id: string, role: Message['role']): Message => ({
  id, role, content: '', streaming: role === 'assistant', tools: [], proposals: [],
});

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  running: false,
  error: null,

  async send(text, view, attachment) {
    const trimmed = text.trim();
    // A photo alone is a whole question ("what is this?").
    if ((!trimmed && !attachment) || get().running) return;
    // Nothing reaches the model, and nothing is added to the thread, without a yes.
    if (!(await chatConfig.ensureConsent())) return;

    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    /*
     * History from state BEFORE the new turn is added. Reading it back after
     * would include the empty assistant placeholder.
     *
     * Only the NEW turn carries its photo. Earlier photos would be uploaded and
     * billed again on every later message. Empty assistant turns (tool activity
     * only) are dropped; some providers reject them.
     */
    const history = [
      ...get().messages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: trimmed, image: attachment?.dataUrl },
    ].slice(-MAX_HISTORY);

    set((s) => ({
      messages: [...s.messages, { ...blank(`local_${Date.now()}`, 'user'), content: trimmed, streaming: false, image: attachment?.uri }],
      running: true,
      error: null,
    }));

    /** Change the message with this id, creating it on first sight. */
    const upsert = (id: string, change: (m: Message) => Message) =>
      set((s) => ({
        messages: s.messages.some((m) => m.id === id)
          ? s.messages.map((m) => (m.id === id ? change(m) : m))
          : [...s.messages, change(blank(id, 'assistant'))],
      }));

    /**
     * Tool activity belongs to the turn in progress. The model usually reads
     * BEFORE it speaks, so this often has to start the assistant message.
     */
    const onTurn = (change: (m: Message) => Message) =>
      set((s) => {
        const last = s.messages.at(-1);
        return last?.role === 'assistant' && last.streaming
          ? { messages: s.messages.map((m) => (m === last ? change(m) : m)) }
          : { messages: [...s.messages, change(blank(`turn_${Date.now()}`, 'assistant'))] };
      });

    let ended = false;
    try {
      const run = runAgent({
        baseUrl: chatConfig.baseUrl,
        path: '/api/agent/chat',
        token: chatConfig.token,
        refresh: chatConfig.refresh,
        signal: controller.signal,
        body: {
          messages: history,
          view,
          clientNow: Date.now(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });

      for await (const event of run) {
        apply(event);
        if (isTerminal(event)) {
          ended = true;
          break;
        }
      }

      // The stream closed with no runFinished or runError: a proxy or the
      // network cut it. Say so, or the answer just stops mid-sentence.
      if (!ended && !controller.signal.aborted)
        set({ error: { code: 'connectionLost', message: '' } });
    } catch (cause) {
      // A failure before the stream opened never reaches runError. Both paths
      // must end the same way, or the input stays disabled for good.
      if (!controller.signal.aborted) set({ error: refusalOf(cause) });
    } finally {
      if (inFlight === controller) inFlight = null;
      set((s) => ({ running: false, messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }));
    }

    function apply(event: AgentEvent) {
      switch (event.type) {
        case 'runStarted':
          return;
        case 'textStart':
          return upsert(event.messageId, (m) => ({ ...m, streaming: true }));
        case 'textDelta':
          return upsert(event.messageId, (m) => ({ ...m, content: m.content + event.delta }));
        case 'textEnd':
          return upsert(event.messageId, (m) => ({ ...m, streaming: false }));
        case 'toolStart':
          return onTurn((m) => ({ ...m, tools: [...m.tools, { callId: event.callId, name: event.name }] }));
        case 'toolResult':
          return onTurn((m) => ({
            ...m,
            tools: m.tools.map((t) => (t.callId === event.callId ? { ...t, summary: event.summary, failed: event.failed } : t)),
          }));
        case 'proposal':
          // Validate the commands here against what is on screen NOW, and drop
          // a card that would do nothing. The model's sentence already explains.
          return onTurn((m) => ({
            ...m,
            proposals: [...m.proposals, { id: event.proposalId, target: event.target, commands: event.commands }],
          }));
        case 'runFinished':
          if (event.reason !== 'stop') onTurn((m) => ({ ...m, cut: event.reason as Exclude<FinishReason, 'stop'> }));
          return;
        case 'runError':
          return set({ error: { code: event.code, message: event.message } });
      }
    }
  },

  stop() {
    inFlight?.abort();
    inFlight = null;
    set((s) => ({ running: false, messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }));
  },

  reset() {
    get().stop();
    set({ messages: [], error: null });
  },

  async applyProposal(id) {
    const proposal = get().messages.flatMap((m) => m.proposals).find((p) => p.id === id);
    if (!proposal || proposal.outcome) return;
    // Re-validate against state as it is NOW: it may have changed since the
    // card appeared. Then apply through the same code path your UI uses.
    const ok = await applyCommands(proposal.target, proposal.commands);
    mark(set, id, ok ? 'applied' : 'failed');
  },

  dismissProposal(id) {
    mark(set, id, 'dismissed');
  },
}));

function mark(set: (fn: (s: ChatState) => Partial<ChatState>) => void, id: string, outcome: Proposal['outcome']) {
  set((s) => ({
    messages: s.messages.map((m) => ({ ...m, proposals: m.proposals.map((p) => (p.id === id ? { ...p, outcome } : p)) })),
  }));
}

/**
 * Apply a proposal with your app's own write path (the same one a button
 * uses), so undo, sync and validation work the same way. Return false when
 * the commands no longer fit the current state.
 */
async function applyCommands(target: ProposalTarget, commands: unknown[]): Promise<boolean> {
  switch (target) {
    case 'item':
      // e.g. return useItemsStore.getState().applyAll(parseItemCommands(commands));
      return commands.length > 0;
  }
}

/** A refusal before the stream opened, as a code the UI has a branch for. */
export function refusalOf(cause: unknown): { code: AgentErrorCode; message: string } {
  if (cause instanceof StreamRefused) {
    const code: AgentErrorCode = isErrorCode(cause.code) ? cause.code
      : cause.status === 401 ? 'unauthorized'
      : cause.status === 429 ? 'rateLimited'
      : 'unknown';
    // The server's sentence, where it sent one: only it knows the reset date.
    return { code, message: cause.detail ?? '' };
  }
  return { code: 'connectionLost', message: '' };
}

/** What to say, in the app's voice rather than the transport's. */
export function explainError(code: AgentErrorCode, message: string): string {
  switch (code) {
    case 'unauthorized': return 'Signed out. Open the app again and retry.';
    case 'rateLimited': return 'Too many questions at once. Give it a minute.';
    case 'timeout': return 'That took too long. Try a shorter question.';
    case 'connectionLost': return 'The connection dropped. Try again.';
    // Normally the screen opens the paywall before sending. This is the race
    // where the subscription lapsed while the sheet was open.
    case 'entitlementRequired': return message || 'This is part of the paid plan.';
    // Must not read like the rate limit: waiting a minute does not help.
    case 'budgetExhausted': return message || 'You have used this month’s allowance.';
    case 'consentRequired': return 'Allow AI features in Settings to use this.';
    case 'providerError':
    case 'unknown': return message || 'That did not work. Try again.';
  }
}
