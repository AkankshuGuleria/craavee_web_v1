/**
 * Order history.
 *
 * Before this screen the product forgot your order the moment you closed
 * it — there was exactly one route to an order (the confirmation push
 * after checkout) and no way back. The Phase 10 audit recorded that as
 * launch blocker B20.
 *
 * Active orders are separated from past ones and pinned at the top,
 * because the two are different jobs: an active order is something you
 * are waiting on *right now*, a past order is a record you are looking
 * something up in. Sorting them into one reverse-chronological list makes
 * the urgent case scroll away as history accumulates.
 */
import { FlashList } from "@shopify/flash-list";
import { Link } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { EmptyState, ErrorState, Screen, SkeletonList, StatusPill } from "../../../components/ui";
import { rupees } from "../../../lib/format";
import { isTerminal } from "../../../lib/orders/timeline";
import { flattenOrders, useOrders, type OrderSummary } from "../../../hooks/useOrders";
import { theme } from "../../../lib/theme";

type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "order"; key: string; order: OrderSummary };

function buildRows(orders: OrderSummary[]): Row[] {
  const active = orders.filter((o) => !isTerminal(o.status));
  const past = orders.filter((o) => isTerminal(o.status));

  const rows: Row[] = [];
  if (active.length > 0) {
    rows.push({ kind: "header", key: "h:active", label: "Active" });
    for (const o of active) rows.push({ kind: "order", key: o.id, order: o });
  }
  if (past.length > 0) {
    rows.push({ kind: "header", key: "h:past", label: active.length > 0 ? "Past orders" : "Your orders" });
    for (const o of past) rows.push({ kind: "order", key: o.id, order: o });
  }
  return rows;
}

/** Date only — the exact minute matters on the order, not in a list. */
function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function OrdersScreen() {
  const feed = useOrders();
  const { orders } = flattenOrders(feed.data?.pages);
  const rows = useMemo(() => buildRows(orders), [orders]);

  return (
    <Screen padded={false} edges={["top"]}>
      <Text accessibilityRole="header" className="px-4 pb-2 text-2xl font-bold text-brand-deep">
        Your orders
      </Text>

      {feed.isPending ? (
        <View className="px-4 pt-2">
          <SkeletonList rows={4} height={96} />
        </View>
      ) : feed.isError && orders.length === 0 ? (
        <ErrorState
          title="Couldn't load your orders"
          detail="Check your connection and try again."
          onRetry={() => feed.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No orders yet"
          hint="When you place an order it'll appear here, with live tracking."
          action={
            <Link href="/" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start shopping"
                testID="orders-empty-shop"
                className="mt-3 min-h-[44px] justify-center rounded-full bg-brand px-6"
              >
                <Text className="text-sm font-bold text-white">Start shopping</Text>
              </Pressable>
            </Link>
          }
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={({ item: row }) =>
            row.kind === "header" ? (
              <Text
                accessibilityRole="header"
                className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-inkdeep/45"
              >
                {row.label}
              </Text>
            ) : (
              <OrderRow order={row.order} />
            )
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
          onRefresh={() => feed.refetch()}
          refreshing={feed.isFetching && !feed.isPending && !feed.isFetchingNextPage}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <View className="items-center py-6">
                <ActivityIndicator color={theme.brand} />
              </View>
            ) : null
          }
          testID="orders-list"
        />
      )}
    </Screen>
  );
}

function OrderRow({ order }: { order: OrderSummary }) {
  const paidByWallet = order.payable === 0 && order.walletApplied > 0;

  const summary =
    order.firstItemName === null
      ? `${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`
      : order.itemCount > 1
        ? `${order.firstItemName} + ${order.itemCount - 1} more`
        : order.firstItemName;

  return (
    <Link href={`/order/${order.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        // One label carrying the whole row: a screen reader should not have
        // to assemble four fragments to know what this order is.
        accessibilityLabel={`Order from ${shortDate(order.placedAt)}, ${summary}, ${rupees(
          order.payable,
        )}${paidByWallet ? ", paid by wallet" : ""}`}
        accessibilityHint="Opens order details and tracking"
        testID={`order-row-${order.id}`}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        className="mb-3 rounded-2xl border border-inkdeep/10 bg-white p-4"
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[15px] font-semibold text-inkdeep" numberOfLines={1}>
              {summary}
            </Text>
            <Text className="mt-0.5 text-xs text-inkdeep/50">{shortDate(order.placedAt)}</Text>
          </View>
          <View className="shrink-0 items-end">
            <Text className="pr-1 text-base font-bold text-brand-deep">
              {rupees(order.payable)}
            </Text>
            {paidByWallet ? (
              // Without this a wallet-covered order shows a bare "₹0.00"
              // and reads as broken. It is accurate - that IS what was
              // charged - it just needs saying why.
              <Text className="pr-1 text-[10px] text-inkdeep/45">Paid by wallet</Text>
            ) : null}
          </View>
        </View>

        <View className="mt-3 flex-row items-center justify-between">
          {/* The same pill and tone mapping the rest of the product uses,
              rather than a second status vocabulary for the same states. */}
          <StatusPill status={order.status} testID={`order-status-${order.id}`} />
          <Text className="shrink-0 pl-2 text-xs font-semibold text-brand">Track</Text>
        </View>
      </Pressable>
    </Link>
  );
}
