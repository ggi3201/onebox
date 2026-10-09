/**
 * The five things the chat needs from the rest of your app. Edit these.
 */
export const chatConfig = {
  /** Your API, for example process.env.EXPO_PUBLIC_API_URL. No trailing slash. */
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.example.com',

  /** The current access token, from your auth store. */
  token: async (): Promise<string | null> => null,

  /** Refresh the token after a 401. Return true when a new one is ready. */
  refresh: async (): Promise<boolean> => false,

  /**
   * Apple 5.1.2(i): nothing goes to the AI provider without a yes. With the
   * ai-consent skill: `import { ensureAiConsent } from '@/features/aiConsent/store'`.
   */
  ensureConsent: async (): Promise<boolean> => true,

  /**
   * The API answered 403 consentRequired: it has no yes on record. With the
   * ai-consent skill: `import { consentRefused } from '@/features/aiConsent/store'`.
   */
  consentRefused: async (): Promise<void> => {},
};
