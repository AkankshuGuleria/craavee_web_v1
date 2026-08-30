// Phase 4 perf probe for create_order — prompt §27.
//
// Measures the transactional path's latency (p50/p95/p99) with a warm
// stack: a batch of sequential orders for mostly-non-overlapping SKUs,
// then a burst of concurrent orders to confirm deterministic inventory
// locking does not produce avoidable contention. This is a probe, not a
// load test (that is the k6 layer, TEST_STRATEGY.md §3, Phase 12).
//
// Prereqs: `npm run db:start` + `npm run db:reset`, then
// `npm run functions:serve` in another terminal (FUNCTIONS_PORT=8790).
//
// Run: node scripts/perf-create-order.mjs [sequentialN] [burstN]

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const FN = `http://127.0.0.1:${process.env.FUNCTIONS_PORT ?? "8790"}/functions/v1/create_order`;

const SEQ = Number(process.argv[2] ?? 40);
const BURST = Number(process.argv[3] ?? 20);

const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

const STORE = "e5000000-0000-4000-8000-000000000001";
const ZONE = "e5000000-0000-4000-8000-000000000101";

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function setup() {
  await svc.from("stores").upsert({ id: STORE, name: "perf store", is_open: true, max_queue_depth: 999999 });
  await svc.from("zones").upsert({ id: ZONE, store_id: STORE, name: "perf zone", delivery_fee: 1000, is_serviceable: true });
  const productIds = [];
  for (let i = 0; i < Math.max(SEQ, BURST) + 5; i++) {
    const id = randomUUID();
    productIds.push(id);
    await svc.from("products").upsert({ id, store_id: STORE, name: `perf ${i}`, mrp: 5000, sale_price: 4000, category: "X", is_listed: true });
    await svc.from("inventory").upsert({ store_id: STORE, product_id: id, qty_on_hand: 100000, qty_reserved: 0 });
  }

  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.verifyOtp({ phone: "9990000004", token: "123456", type: "sms" });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  const jwt = data.session.access_token;
  const addr = randomUUID();
  await svc.from("addresses").insert({ id: addr, customer_id: data.session.user.id, zone_id: ZONE, block: "P", room: "1" });
  return { jwt, addr, productIds };
}

async function one(jwt, addr, productId) {
  const t = performance.now();
  const r = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ idempotencyKey: randomUUID(), addressId: addr, items: [{ productId, qty: 1 }] }),
  });
  await r.json();
  return { ms: performance.now() - t, status: r.status };
}

function report(label, samples) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const okRate = samples.filter((s) => s.status === 200).length / samples.length;
  console.log(
    `${label.padEnd(22)} n=${samples.length}  p50=${pct(ms, 50).toFixed(0)}ms  ` +
      `p95=${pct(ms, 95).toFixed(0)}ms  p99=${pct(ms, 99).toFixed(0)}ms  ` +
      `max=${ms[ms.length - 1].toFixed(0)}ms  ok=${(okRate * 100).toFixed(0)}%`,
  );
}

const { jwt, addr, productIds } = await setup();

// warm
await one(jwt, addr, productIds[0]);

const seq = [];
for (let i = 0; i < SEQ; i++) seq.push(await one(jwt, addr, productIds[i + 1]));
report("sequential (own SKU)", seq);

// burst: all hitting the SAME low-set of SKUs -> exercises the fixed
// ascending-product_id inventory lock under contention
const hotSkus = productIds.slice(0, 3);
const burst = await Promise.all(
  Array.from({ length: BURST }, (_, i) => one(jwt, addr, hotSkus[i % hotSkus.length])),
);
report("burst (3 shared SKUs)", burst);

console.log("\nNote: local single-node stack; treat these as a relative baseline, not a capacity number.");
process.exit(0);
