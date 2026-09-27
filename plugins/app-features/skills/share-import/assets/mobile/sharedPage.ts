/**
 * What the share extension lifted out of the page the person shared.
 *
 * Held in a module, not a router param: it can be tens of KB, and params are
 * serialised into the URL.
 */
export type SharedPage = {
  /** The schema.org node of the wanted type, as JSON. Present is not the same as good. */
  ldJson: string | null;
  /** The article text as the reader saw it. The ground truth to fall back on. */
  pageText: string | null;
};

let pending: SharedPage | null = null;

export function setSharedPage(page: SharedPage): void {
  if (page.ldJson || page.pageText) pending = page;
}

/**
 * Read and clear. One share is one action and one import, so there is nothing
 * to key it by. Keying by URL failed on devices: the extension records
 * `document.baseURI` while a plain URL attachment records what Safari handed
 * over, and a redirect or a canonical rewrite makes them differ. The mismatch
 * silently fell back to fetching the URL: the blocked path this exists to avoid.
 */
export function takeSharedPage(): SharedPage | null {
  const page = pending;
  pending = null;
  return page;
}

/**
 * Pull the page out of the RAW share payload, before the library reduces it.
 *
 * iOS can hand the extension TWO attachments for one share: the preprocessed
 * page (with `meta`) and a bare URL (meta ""). The library keeps `weburls[0]`,
 * so whether the page survives depends on attachment order. It survived on
 * the simulator and not on a phone. So scan every entry.
 */
export function captureFromRawShare(raw: unknown): void {
  if (typeof raw !== 'string' || !raw) return;
  let payload: { weburls?: { url?: string; meta?: string }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  for (const entry of payload?.weburls ?? []) {
    if (!entry?.meta) continue;
    try {
      const meta = JSON.parse(entry.meta) as Record<string, string | undefined>;
      const page = { ldJson: meta['ld-json'] ?? null, pageText: meta['page-text'] ?? null };
      if (page.ldJson || page.pageText) return setSharedPage(page);
    } catch {
      // try the next entry
    }
  }
}
