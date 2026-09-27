#!/usr/bin/env bash
# Small fake project the delegate cases run against. Writes into the cwd.
set -euo pipefail
mkdir -p src/middleware src/routes src/orders test
cat > src/config.ts <<'T'
export const MAX_UPLOAD_MB = 25;
export const SESSION_TTL_HOURS = 72;
T
cat > src/middleware/auth.ts <<'T'
export function requireUser(req: any) {
  if (!req.user) throw new Error("unauthorized");
}
T
cat > src/middleware/throttle.ts <<'T'
const hits = new Map<string, number[]>();

export function limitRequests(key: string, perMinute = 30): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}
T
cat > src/routes/search.ts <<'T'
import { limitRequests } from "../middleware/throttle";
import { requireUser } from "../middleware/auth";

export function search(req: any) {
  requireUser(req);
  if (!limitRequests(`search:${req.user.id}`, 20)) {
    return { status: 429 };
  }
  return { status: 200, results: [] };
}
T
cat > src/routes/upload.ts <<'T'
import { MAX_UPLOAD_MB } from "../config";
export function upload(req: any) {
  if (req.sizeMb > MAX_UPLOAD_MB) return { status: 413 };
  return { status: 201 };
}
T
cat > src/orders/list.ts <<'T'
export type Order = { id: string; region: string; status: "open" | "shipped" | "cancelled" };

export function listOrders(orders: Order[], filters: { region?: string }) {
  let out = orders;
  if (filters.region) out = out.filter((o) => o.region === filters.region);
  return out;
}
T
cat > test/orders.test.mjs <<'T'
// Run: node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { listOrders } from "../src/orders/list.ts";

const orders = [
  { id: "1", region: "eu", status: "open" },
  { id: "2", region: "us", status: "shipped" },
  { id: "3", region: "eu", status: "shipped" },
];

test("region filter", () => {
  assert.deepEqual(listOrders(orders, { region: "eu" }).map((o) => o.id), ["1", "3"]);
});
T
cat > package.json <<'T'
{ "name": "fixture", "type": "module", "scripts": { "test": "node --experimental-strip-types --test test/" } }
T
