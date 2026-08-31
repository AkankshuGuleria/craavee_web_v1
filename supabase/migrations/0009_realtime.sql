-- ============================================================
-- Phase 8, Part B — staff Realtime
-- ============================================================
-- D21 exactly: Supabase Realtime (Postgres Changes) on `orders` and
-- `inventory`, filtered to the operator's own store, consumed by
-- Store / Runner / Console only.
--
-- **Customers never open a Realtime channel** (D20). The customer app
-- polls its own order on an 8s/30s schedule. That is not an oversight to
-- be "improved" later - it is the specific mitigation for the dossier's
-- launch-day failure #4, socket fan-out at 800 concurrent customers.
--
-- Note what that does and does not mean. `orders_select` grants a
-- customer their own rows, so a customer who chose to open a socket
-- WOULD receive their own order and nothing else - measured, not
-- assumed. D20 is therefore a client-architecture guarantee, not a
-- database one, and the integration suite enforces it as such: it
-- asserts the customer is scoped to rows they own, and separately scans
-- the shipped app to prove no customer surface opens a channel at all.
--
-- Authorization is NOT a new mechanism. Supabase Realtime evaluates the
-- same RLS policies as the underlying table for each subscriber, so
-- `orders_select` (0003) is what stops a store-A packer from reading
-- store-B rows - even if they guess the channel name and remove the
-- client-side filter. The `store_id=eq.<id>` filter clients send is a
-- bandwidth optimisation, not the security boundary.
--
-- Realtime is a delivery mechanism, never a source of truth. A client
-- that misses an event recovers by refetching; correctness never depends
-- on a websocket message arriving.

-- ---- Publication membership -------------------------------------
-- supabase_realtime already exists (created by the platform) but is
-- empty. Adding a table is idempotent-guarded because a re-run of this
-- migration against a database where it is already present would
-- otherwise raise.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory'
  ) then
    alter publication supabase_realtime add table inventory;
  end if;
end;
$$;

-- ---- Replica identity -------------------------------------------
-- Postgres only puts the primary key in the WAL for an UPDATE by
-- default, so a subscriber filtering on `store_id` would not see that
-- column on the OLD record and Realtime could not evaluate the filter
-- reliably for updates. FULL puts every column in the WAL.
--
-- The cost is WAL volume, which is acceptable here: these are two
-- narrow, low-write tables (an order changes status a handful of times
-- in its life), not a high-frequency event log.
alter table orders    replica identity full;
alter table inventory replica identity full;

comment on table orders is
  'Realtime (D21): in supabase_realtime with REPLICA IDENTITY FULL so staff clients can filter Postgres Changes by store_id. Per-subscriber visibility is decided by orders_select RLS, not by the client filter.';
