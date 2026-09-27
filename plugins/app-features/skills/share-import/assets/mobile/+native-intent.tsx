/**
 * app/+native-intent.tsx
 *
 * The share extension opens the app with a URL like
 * `myapp://dataUrl=myappShareKey?nonce=...`. It matches no route, so
 * expo-router shows `+not-found` for a moment (a visible "page not found"
 * flash) before the share hook navigates.
 *
 * The payload is NOT in this URL; it is a hand-off signal. Send it to a route
 * that exists, and let the share hook navigate once the intent is parsed.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=')) return '/';
  return path;
}
