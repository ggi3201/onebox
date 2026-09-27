/**
 * Permission to send someone's data to a third-party AI, asked once.
 *
 * Apple 5.1.2(i): say where personal data goes when it is shared with a
 * third-party AI, and get explicit permission BEFORE it goes. Every AI feature
 * awaits `ensureAiConsent()` first and does nothing on a "no".
 *
 * - Only a yes is stored. "Not now" asks again next time, because next time is
 *   someone tapping an AI feature on purpose.
 * - The yes is stored with a VERSION. Change the provider or what you send,
 *   bump `CONSENT_VERSION`, and everyone is asked again.
 * - The yes is also sent to the server, which enforces it and survives a
 *   reinstall. The local copy only avoids asking before the server answers.
 * - Two checks at once share ONE prompt and one answer. A naive version keeps
 *   one resolver and overwrites it, and the first caller waits forever.
 *
 * Needs: @react-native-async-storage/async-storage, zustand
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/** Bump when the provider, the data sent or the purpose changes. Must match AiConsent:Version on the server. */
export const CONSENT_VERSION = 1;
const KEY = 'myapp.aiConsent';

/** Your API calls. Wire them to your fetch helper. */
export const consentApi = {
  /** The version the server has on record for this user, or null. */
  get: async (): Promise<number | null> => null,
  record: async (_version: number): Promise<void> => {},
  revoke: async (): Promise<void> => {},
};

interface State {
  granted: boolean;
  loaded: boolean;
  /** A check is waiting, so the prompt is on screen. */
  asking: boolean;
  load: () => Promise<void>;
  answer: (agreed: boolean) => void;
  revoke: () => Promise<void>;
}

let waiters: ((agreed: boolean) => void)[] = [];
let loading: Promise<void> | null = null;

export const useAiConsentStore = create<State>((set, get) => ({
  granted: false,
  loaded: false,
  asking: false,

  load() {
    loading ??= (async () => {
      let version = 0;
      try {
        version = Number(await AsyncStorage.getItem(KEY)) || 0;
      } catch {
        // Unreadable storage asks again: the safe direction.
      }
      if (version < CONSENT_VERSION) {
        try {
          version = Math.max(version, (await consentApi.get()) ?? 0);
        } catch {
          // Offline: ask; the answer is recorded when the network is back.
        }
      }
      // Never undo a yes given while this was loading.
      set({ granted: get().granted || version >= CONSENT_VERSION, loaded: true });
    })();
    return loading;
  },

  answer(agreed) {
    set({ asking: false, granted: get().granted || agreed });
    if (agreed) {
      AsyncStorage.setItem(KEY, String(CONSENT_VERSION)).catch(() => {});
      consentApi.record(CONSENT_VERSION).catch(() => {});
    }
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve(agreed));
  },

  async revoke() {
    set({ granted: false });
    loading = null;
    await AsyncStorage.removeItem(KEY).catch(() => {});
    await consentApi.revoke();
  },
}));

/** True when the person has agreed, asking first if they have not. */
export async function ensureAiConsent(): Promise<boolean> {
  await useAiConsentStore.getState().load();
  if (useAiConsentStore.getState().granted) return true;
  return new Promise((resolve) => {
    waiters.push(resolve);
    useAiConsentStore.setState({ asking: true });
  });
}
