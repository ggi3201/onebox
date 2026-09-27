/**
 * Start a server job, follow it, and pick it up again after the app restarts.
 *
 * - Polls every 1.5 s while the app is in the FOREGROUND, and not at all in
 *   the background (a push tells the person when it is done).
 * - Saves the running job's id per user, so a relaunch resumes it instead of
 *   losing it. Never resumes another user's job after an account switch:
 *   clear the pointers on sign-out.
 * - Stops on a terminal status and clears the pointer.
 *
 * Needs: @react-native-async-storage/async-storage
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export type JobStatus = 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
export interface JobView<R = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  progress: string | null;
  result: R | null;
  error: string | null;
}

/** Your API calls. Map non-2xx to thrown errors that carry `{ status, code, message }`. */
export const jobsApi = {
  start: async (_kind: string, _input: unknown): Promise<JobView> => { throw new Error('wire jobsApi.start'); },
  get: async (_id: string): Promise<JobView> => { throw new Error('wire jobsApi.get'); },
  cancel: async (_id: string): Promise<void> => {},
};

const POLL_MS = 1500;
const terminal = (s: JobStatus) => s === 'Completed' || s === 'Failed' || s === 'Cancelled';
const keyFor = (kind: string, userId: string) => `myapp.job.v1:${kind}:${userId}`;

export async function clearJobPointers(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('myapp.job.v1:')));
}

export function useJob<R = unknown>(kind: string, userId: string | null) {
  const [job, setJob] = useState<JobView<R> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef<string | null>(null);

  const stopPolling = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async (id: string) => {
    stopPolling();
    if (active.current !== id) return;
    try {
      const next = (await jobsApi.get(id)) as JobView<R>;
      if (active.current !== id) return;
      setJob(next);
      if (terminal(next.status)) {
        active.current = null;
        if (userId) await AsyncStorage.removeItem(keyFor(kind, userId));
        return;
      }
    } catch (e) {
      // 404: the job is gone (cleaned up, or not ours). Forget it.
      if ((e as { status?: number })?.status === 404) {
        active.current = null;
        if (userId) await AsyncStorage.removeItem(keyFor(kind, userId));
        return;
      }
      // Anything else: a blip. Keep polling.
    }
    if (AppState.currentState === 'active') timer.current = setTimeout(() => void poll(id), POLL_MS);
  }, [kind, userId]);

  // Resume after a relaunch.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void AsyncStorage.getItem(keyFor(kind, userId)).then((id) => {
      if (cancelled || !id) return;
      active.current = id;
      void poll(id);
    });
    return () => { cancelled = true; };
  }, [kind, userId, poll]);

  // Pause in the background, resume in the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && active.current) void poll(active.current);
      else stopPolling();
    });
    return () => { sub.remove(); stopPolling(); };
  }, [poll]);

  /**
   * Start. Do NOT call this automatically from a share or a deep link: one
   * mis-tap on the share sheet would spend a paid job. Let the person tap.
   */
  const start = useCallback(async (input: unknown) => {
    if (!userId) return;
    setError(null);
    try {
      const created = (await jobsApi.start(kind, input)) as JobView<R>;
      setJob(created);
      active.current = created.id;
      await AsyncStorage.setItem(keyFor(kind, userId), created.id);
      void poll(created.id);
    } catch (e) {
      // 402 / 429 / 403 carry { code, message }: map them like the chat does
      // (paywall, the server's sentence, the consent prompt).
      setError(e);
    }
  }, [kind, userId, poll]);

  const cancel = useCallback(async () => {
    const id = active.current;
    if (!id) return;
    active.current = null;
    stopPolling();
    await jobsApi.cancel(id).catch(() => {});
    if (userId) await AsyncStorage.removeItem(keyFor(kind, userId));
    setJob((j) => (j ? { ...j, status: 'Cancelled' } : j));
  }, [kind, userId]);

  return { job, error, start, cancel, running: !!job && !terminal(job.status) };
}
