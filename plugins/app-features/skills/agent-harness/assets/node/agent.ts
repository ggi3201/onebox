/**
 * The agent loop, for a Node API. Same design as the .NET template
 * (assets/dotnet/Agent/AgentLoop.cs); read references/loop.md for the why.
 *
 * Any provider with the OpenAI Chat Completions format works: set
 * LLM_BASE_URL, LLM_API_KEY and LLM_MODEL. This is the only file that knows
 * the SDK.
 */
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';

// --- the wire protocol (twin of protocol.ts in chat-feature) ----------------

export type AgentEvent =
  | { type: 'runStarted'; runId: string }
  | { type: 'textStart'; messageId: string }
  | { type: 'textDelta'; messageId: string; delta: string }
  | { type: 'textEnd'; messageId: string }
  | { type: 'toolStart'; callId: string; name: string }
  | { type: 'toolResult'; callId: string; summary: string; failed: boolean }
  | { type: 'proposal'; proposalId: string; target: string; commands: unknown[] }
  | { type: 'runFinished'; runId: string; reason: 'stop' | 'length' | 'toolLimit' }
  | { type: 'runError'; code: string; message: string };

export const sseFrame = (e: AgentEvent) => `data: ${JSON.stringify(e)}\n\n`;
export const SSE_KEEP_ALIVE = ': keep-alive\n\n';

// --- tools --------------------------------------------------------------------

export interface ToolContext {
  userId: string;
  view: { kind: string; [key: string]: unknown };
  clientNow: Date;
  timezone: string;
  image: string | null;
  signal: AbortSignal;
}

export interface ToolResult {
  /** Goes back to the model. Can be long. */
  forModel: string;
  /** One line for the person. */
  summary?: string;
  /** A change to OFFER. Nothing has been written. */
  proposal?: { target: string; commands: unknown[] };
  failed?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters?: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// --- limits -------------------------------------------------------------------

export const LIMITS = {
  maxMessages: 40,
  maxContentChars: 16_000,
  maxTotalChars: 60_000,
  maxImageChars: 5_500_000,
  runDeadlineMs: 90_000,
  toolTimeoutMs: 20_000,
  maxToolIterations: Number(process.env.LLM_MAX_TOOL_ITERATIONS ?? 5),
  maxOutputTokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 2048),
};

export interface AgentTurn { role: 'user' | 'assistant'; content: string; image?: string }
export interface AgentRequest {
  messages: AgentTurn[];
  view: { kind: string; [key: string]: unknown };
  clientNow: number;
  timezone: string;
}

/** Null when in bounds. Check BEFORE the stream opens, so a refusal is a 400. */
export function violation(r: AgentRequest): string | null {
  if (!Array.isArray(r.messages) || r.messages.length === 0) return 'no messages';
  if (r.messages.length > LIMITS.maxMessages) return `more than ${LIMITS.maxMessages} messages`;
  let prose = 0;
  for (const t of r.messages) {
    if (t.role !== 'user' && t.role !== 'assistant') return 'a message with an unknown role';
    const c = t.content ?? '';
    if (c.length > LIMITS.maxContentChars) return 'a message over the size limit';
    if (t.image && t.image.length > LIMITS.maxImageChars) return 'an image over the size limit';
    // A photo from the phone, never a URL the provider would fetch on your key.
    if (t.image && !/^data:image\/[a-z+.-]+;base64,/i.test(t.image)) return 'an image that is not a photo';
    prose += c.length;
  }
  return prose > LIMITS.maxTotalChars ? 'a conversation over the size limit' : null;
}

// --- the loop -----------------------------------------------------------------

export interface Usage { input: number; cached: number; output: number }

export interface RunOptions {
  userId: string;
  tools: AgentTool[];
  /** Your stable prompt: no clock, no user, nothing from the request. */
  stablePrompt: string;
  /** Everything request-shaped, as the second system message. */
  volatilePrompt: (ctx: ToolContext) => string;
  /** Called once per run, on every path, with what the provider billed. */
  recordUsage: (usage: Usage) => Promise<void>;
  signal: AbortSignal;
}

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  apiKey: process.env.LLM_API_KEY ?? '',
});
const MODEL = process.env.LLM_MODEL ?? '';

const CLOSING_NOTE =
  '[Note from the app, not from the person: the tool budget for this answer is spent. ' +
  'Answer now, in text, with what you already have. Do not say a change was made unless a tool made it.]';

export async function* runAgent(request: AgentRequest, o: RunOptions): AsyncGenerator<AgentEvent> {
  if (!process.env.LLM_API_KEY || !MODEL) throw new Error('LLM_API_KEY and LLM_MODEL must be set.');

  // The deadline lives here, so background jobs get it too.
  const deadline = AbortSignal.timeout(LIMITS.runDeadlineMs);
  const signal = AbortSignal.any([o.signal, deadline]);
  const runId = `run_${crypto.randomUUID().replace(/-/g, '')}`;
  const usage: Usage = { input: 0, cached: 0, output: 0 };
  let openCall: { inputChars: number; outputChars: number } | null = null;

  try {
    yield { type: 'runStarted', runId };

    const newestImage = [...request.messages].reverse().find((m) => m.role === 'user' && m.image)?.image ?? null;
    const ctx: ToolContext = {
      userId: o.userId, view: request.view, clientNow: new Date(request.clientNow),
      timezone: request.timezone, image: newestImage, signal,
    };

    // Stable FIRST and alone, so the provider's prefix cache covers it and the tools.
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: o.stablePrompt },
      { role: 'system', content: o.volatilePrompt(ctx) },
    ];
    request.messages.forEach((t, i) => {
      if (t.role === 'assistant') {
        if (t.content.trim()) messages.push({ role: 'assistant', content: t.content }); // drop empty turns
      } else if (i === request.messages.length - 1 && t.image) {
        // Text first, then the photo: with the photo first, models describe it before answering.
        messages.push({ role: 'user', content: [
          { type: 'text', text: t.content.trim() || '[They sent a photo and no text.]' },
          { type: 'image_url', image_url: { url: t.image } },
        ] });
      } else {
        messages.push({ role: 'user', content: t.content || '[A photo was attached earlier.]' });
      }
    });

    // Sorted: tool definitions are part of the cached prefix.
    const byName = new Map([...o.tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [t.name, t]));
    const definitions: ChatCompletionTool[] = [...byName.values()].map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters ?? { type: 'object', properties: {} } },
    }));
    let promptChars = JSON.stringify(messages).length + JSON.stringify(definitions).length;

    for (let call = 0; call <= LIMITS.maxToolIterations; call++) {
      // Last call: same tools (cache stays warm), tool_choice none, a user-role note.
      const closing = call === LIMITS.maxToolIterations;
      if (closing) {
        messages.push({ role: 'user', content: CLOSING_NOTE });
        promptChars += CLOSING_NOTE.length;
      }

      const params: ChatCompletionCreateParamsStreaming = {
        model: MODEL,
        messages,
        stream: true,
        // Without this, a streamed call reports no usage at all: it looks free.
        stream_options: { include_usage: true },
        max_completion_tokens: closing ? Math.max(256, LIMITS.maxOutputTokens / 4) : LIMITS.maxOutputTokens,
        ...(definitions.length ? { tools: definitions, tool_choice: closing ? 'none' : 'auto' } : {}),
      };

      const messageId = `msg_${runId}_${call}`;
      let text = '';
      let textOpen = false;
      let finish: string | null = null;
      const calls = new Map<number, { id?: string; name?: string; args: string }>();

      openCall = { inputChars: promptChars, outputChars: 0 };
      let stream;
      try {
        stream = await client.chat.completions.create(params, { signal });
      } catch (e) {
        if (signal.aborted) throw e;
        openCall = null; // refused before it started: not billed
        console.error(`Agent run ${runId} provider error`, e);
        yield { type: 'runError', code: 'providerError', message: 'The assistant could not answer that. Please try again.' };
        return;
      }

      for await (const chunk of stream) {
        // Usage is the LAST chunk and often has no choices.
        if (chunk.usage) {
          usage.input += chunk.usage.prompt_tokens;
          usage.cached += chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
          usage.output += chunk.usage.completion_tokens;
          openCall = null;
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;

        const delta = choice.delta?.content;
        if (delta) {
          if (!textOpen) { textOpen = true; yield { type: 'textStart', messageId }; }
          text += delta;
          if (openCall) openCall.outputChars += delta.length;
          yield { type: 'textDelta', messageId, delta };
        }
        // Fragments: id in one chunk, name in another, arguments a few characters at a time.
        for (const t of choice.delta?.tool_calls ?? []) {
          const p = calls.get(t.index) ?? { args: '' };
          if (t.id) p.id = t.id;
          if (t.function?.name) p.name = t.function.name;
          if (t.function?.arguments) { p.args += t.function.arguments; if (openCall) openCall.outputChars += t.function.arguments.length; }
          calls.set(t.index, p);
        }
      }
      if (textOpen) yield { type: 'textEnd', messageId };

      // Keyed on "did it ask for tools", not on finish_reason: providers disagree.
      if (calls.size === 0 || closing) {
        const reason = closing ? 'toolLimit' : finish === 'length' ? 'length' : 'stop';
        yield { type: 'runFinished', runId, reason };
        return;
      }

      // One id per call, used everywhere.
      const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c], i) => ({ ...c, id: c.id ?? `call_${runId}_${call}_${i}` }));
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: ordered.map((c) => ({ id: c.id, type: 'function', function: { name: c.name ?? 'unknown', arguments: c.args || '{}' } })),
      });
      promptChars += text.length + ordered.reduce((n, c) => n + c.args.length, 0);

      for (const c of ordered) {
        const name = c.name ?? 'unknown';
        yield { type: 'toolStart', callId: c.id, name };
        const result = await execute(byName.get(name), name, c.args, ctx);
        yield { type: 'toolResult', callId: c.id, summary: result.summary ?? 'Done', failed: !!result.failed };
        if (result.proposal) yield { type: 'proposal', proposalId: `pr_${c.id}`, ...result.proposal };
        messages.push({ role: 'tool', tool_call_id: c.id, content: result.forModel });
        promptChars += result.forModel.length;
      }
    }
  } catch (e) {
    if (o.signal.aborted) throw e; // the client hung up: nobody to tell
    if (deadline.aborted) {
      yield { type: 'runError', code: 'timeout', message: 'That took too long. Please try again.' };
      return;
    }
    throw e;
  } finally {
    // Every path. A hang-up before the usage chunk still cost money: estimate it.
    if (openCall) {
      usage.input += Math.round(openCall.inputChars / 4);
      usage.output += Math.round(openCall.outputChars / 4);
    }
    if (usage.input > 0 || usage.output > 0) {
      await o.recordUsage(usage).catch((e) => console.warn(`Could not record usage for ${o.userId}`, e));
    }
  }
}

async function execute(tool: AgentTool | undefined, name: string, raw: string, ctx: ToolContext): Promise<ToolResult> {
  if (!tool) return { forModel: `${name} is not available here. Use one of the tools you were given.`, summary: `${name} is not available here`, failed: true };

  let args: Record<string, unknown>;
  try {
    args = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return { forModel: `Your arguments were not valid JSON (${String(e)}). Try again.`, summary: `${name} got malformed arguments`, failed: true };
  }

  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(LIMITS.toolTimeoutMs)]);
  try {
    return await tool.run(args, { ...ctx, signal });
  } catch (e) {
    if (ctx.signal.aborted) throw e; // the RUN was cancelled
    console.error(`Tool ${name} failed`, e);
    return signal.aborted
      ? { forModel: `${name} took too long and was stopped.`, summary: `${name} timed out`, failed: true }
      : { forModel: `The ${name} tool failed. Try another way.`, summary: `${name} failed`, failed: true };
  }
}
