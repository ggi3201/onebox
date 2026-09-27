/**
 * POST /api/agent/chat for Express (or anything that hands you Node's req/res).
 * Every refusal happens BEFORE the first byte; after it, the status is 200 and
 * committed, and a refusal can only be a runError inside the stream.
 */
import type { Request, Response } from 'express';
import { runAgent, sseFrame, SSE_KEEP_ALIVE, violation, type AgentRequest, type AgentTool } from './agent';

/** Open runs per user. In memory: one API instance only. */
const inFlight = new Map<string, number>();
const MAX_CONCURRENT = 3;

export interface ChatDeps {
  userIdOf: (req: Request) => string | null;
  /** Subscription, budget, consent. Null means allowed. */
  checkAccess: (userId: string) => Promise<{ status: number; code: string; message: string } | null>;
  tools: AgentTool[];
  stablePrompt: string;
  volatilePrompt: Parameters<typeof runAgent>[1]['volatilePrompt'];
  recordUsage: (userId: string, usage: { input: number; cached: number; output: number }) => Promise<void>;
}

export function chatHandler(deps: ChatDeps) {
  return async (req: Request, res: Response) => {
    const userId = deps.userIdOf(req);
    if (!userId) return res.status(401).end();

    const body = req.body as AgentRequest;
    const bad = violation(body);
    if (bad) return res.status(400).json({ code: 'badRequest', message: `Request rejected: ${bad}.` });

    const denial = await deps.checkAccess(userId);
    if (denial) return res.status(denial.status).json({ code: denial.code, message: denial.message });

    if ((inFlight.get(userId) ?? 0) >= MAX_CONCURRENT)
      return res.status(429).json({ code: 'rateLimited', message: 'Too many answers at once.' });
    inFlight.set(userId, (inFlight.get(userId) ?? 0) + 1);

    // Abort on hang-up. `res.on('close')`, not `req.on('close')`: in current
    // Node the request stream closes as soon as the body is read.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Proxies buffer event streams unless told not to.
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.write(SSE_KEEP_ALIVE);
    let last = Date.now();
    const keepAlive = setInterval(() => { if (Date.now() - last > 15_000) res.write(SSE_KEEP_ALIVE); }, 5_000);

    try {
      for await (const evt of runAgent(body, {
        userId, tools: deps.tools, stablePrompt: deps.stablePrompt, volatilePrompt: deps.volatilePrompt,
        recordUsage: (u) => deps.recordUsage(userId, u), signal: abort.signal,
      })) {
        res.write(sseFrame(evt));
        last = Date.now();
      }
    } catch (e) {
      // A code and a plain sentence, never the error text: it can carry hosts and internals.
      if (!abort.signal.aborted) {
        console.error('Agent run failed', e);
        res.write(sseFrame({ type: 'runError', code: 'providerError', message: 'The assistant could not finish that. Please try again.' }));
      }
    } finally {
      clearInterval(keepAlive);
      const n = (inFlight.get(userId) ?? 1) - 1;
      if (n <= 0) inFlight.delete(userId); else inFlight.set(userId, n);
      res.end();
    }
  };
}
