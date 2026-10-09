/**
 * Send a link shared into the app from another app to the import screen.
 *
 * It opens the import screen FILLED IN and does NOT submit. A share is one
 * mis-tap from the wrong link, and an import can cost money: one tap costs
 * less than one wasted import.
 *
 * `enabled` answers "is there anywhere to navigate to yet". A share can land on
 * a cold, signed-out app where the router stack does not exist; the provider
 * holds the intent until this is true, and the intent is reset only after it
 * has been handed on.
 *
 * Mount once, in the root layout, inside <ShareIntentProvider>.
 */
import { useRouter } from 'expo-router';
import { ShareIntentModule, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';

import { captureFromRawShare, setSharedPage } from './sharedPage';

const IMPORT_ROUTE = '/import';

export function useShareImport(enabled: boolean): void {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  // The effect can run again while the router settles; a second push would stack a second screen.
  const handled = useRef<string | null>(null);

  // The RAW payload, alongside the library's reduced one. Registered first; the
  // routing effect below runs a tick later, after a state update.
  useEffect(() => {
    const sub = ShareIntentModule?.addListener('onChange', (event) => {
      captureFromRawShare((event as { value?: unknown })?.value);
    });
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    // No intent: the last one was handed on. The same link may be shared again.
    if (!hasShareIntent) {
      handled.current = null;
      return;
    }
    if (!enabled) return;

    // `webUrl` is set for a plain URL and for text that CONTAINS one, which is
    // what most apps put on the share sheet ("Look at this: https://...").
    const url = shareIntent.webUrl?.trim();
    const text = shareIntent.text?.trim();
    const params = url ? { sharedUrl: url } : text ? { sharedText: text } : null;
    if (!params) return;

    const key = url ?? text ?? '';
    if (handled.current === key) return;
    handled.current = key;

    // Also the reduced payload, for the case where the raw listener missed it.
    setSharedPage({
      ldJson: (shareIntent.meta?.['ld-json'] as string | undefined) ?? null,
      pageText: (shareIntent.meta?.['page-text'] as string | undefined) ?? null,
    });

    router.push({ pathname: IMPORT_ROUTE, params });
    resetShareIntent();
  }, [enabled, hasShareIntent, shareIntent, resetShareIntent, router]);
}
