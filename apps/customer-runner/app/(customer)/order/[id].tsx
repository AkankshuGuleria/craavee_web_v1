import { useMemo } from "react";

import { Link, Stack, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { PaymentIntent } from "@craavee/api-contracts";

import { ErrorState, SkeletonList, StaleBanner, StatusPill } from "../../../components/ui";
import { rupees } from "../../../lib/format";
import { useOrder } from "../../../hooks/useOrder";
import { usePaymentCheckout } from "../../../hooks/usePaymentCheckout";

/**
 * Order confirmation / details — Phase 4 prompt §20, Phase 5 §16/§17/§18.
 *
 * Shows the authoritative, already-persisted order and its PAYMENT state:
 *   pending     — awaiting the gateway; a "Complete payment" affordance
 *                 opens Razorpay Checkout with the server-built params.
 *   successful  — the verified webhook confirmed capture.
 *   failed      — the payment did not go through / the reservation
 *                 expired; the order is released, place a new one.
 *   refunded    — money returned to the wallet (full or partial).
 *
 * The client payment callback is provisional only — this screen re-polls
 * (bounded) and trusts the webhook-driven state, never a client claim
 * (§17). Not the full tracking experience.
 */
export default function OrderScreen() {
  const params = useLocalSearchParams<{ id: string; pi?: string }>();
  const id = params.id;
  const order = useOrder(id);
  const checkout = usePaymentCheckout();

  const paymentIntent = useMemo<PaymentIntent | null>(() => {
    if (!params.pi) return null;
    try {
      return JSON.parse(params.pi) as PaymentIntent;
    } catch {
      return null;
    }
  }, [params.pi]);

  if (order.isPending) {
    return (
      // A skeleton shaped like the order card, not a bare spinner: the
      // layout is known in advance, so holding it prevents the content
      // jumping into place when the poll lands.
      <View className="flex-1 gap-4 bg-paper px-4 pt-4">
        <Stack.Screen options={{ title: "Order", headerShown: true }} />
        <SkeletonList rows={3} height={110} />
      </View>
    );
  }

  // Only a full failure with NOTHING to show gets the error page. The
  // original condition was `order.isError || !order.data`, which threw
  // away perfectly good cached data the moment one poll failed - on a
  // screen that polls every 8 seconds. A transient failure with data in
  // hand is a STALE state, handled below, not a dead end.
  if (!order.data) {
    return (
      // Phase 10E: this was the audit's P0. It read "We couldn't load this
      // order." with a link back to the catalog and NO way to try again -
      // on the screen a customer stares at while waiting for food. The
      // shared ErrorState requires onRetry, so it cannot be built that way.
      <View className="flex-1 bg-paper">
        <Stack.Screen options={{ title: "Order", headerShown: true }} />
        <ErrorState
          title="Couldn't load this order"
          detail="Your order is safe — this is only the screen failing to refresh."
          onRetry={() => order.refetch()}
        />
      </View>
    );
  }

  const o = order.data;
  const confirmed = o.status === "confirmed" || o.status === "packed" || o.status === "assigned" || o.status === "picked_up" || o.status === "delivered";
  const failed = o.status === "payment_failed";
  const cancelled = o.status === "cancelled";
  const awaitingPayment = o.status === "created";
  const refunded = o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded";

  const banner = failed
    ? { title: "Payment didn't go through", body: "Your reservation has been released. Place a new order to try again." }
    : cancelled
      ? { title: "Order cancelled", body: refunded ? `Refunded ${rupees(o.refundedAmount)} to your wallet.` : "This order was cancelled." }
      : confirmed
        ? { title: "Order confirmed", body: refunded ? `A ${rupees(o.refundedAmount)} refund was credited to your wallet.` : "The store will start packing shortly." }
        : { title: "Payment pending", body: "Complete your payment to confirm the order. We're checking with the gateway…" };

  // Phase 10E: the audit's second P0. This screen is poll-driven (D20) and
  // had no concept of a failed poll - a lost connection left the last
  // status on screen indefinitely, presented as current. `isError` with
  // cached data present is exactly that case: we still have something to
  // show, but it is no longer known to be true.
  const isStale = order.isError;

  return (
    <View className="flex-1 bg-paper">
      <Stack.Screen options={{ title: "Order", headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isStale ? (
          <View className="mb-4">
            <StaleBanner kind="stale" onRetry={() => order.refetch()} />
          </View>
        ) : null}

        {/* One status vocabulary across the product: the same pill and the
            same tone mapping the Console uses, rather than a second set of
            words for the same nine states. */}
        <View className="mb-3">
          <StatusPill status={o.status} testID="order-status" />
        </View>

        <View
          className={`mb-4 rounded-2xl p-4 ${
            confirmed && !refunded ? "bg-brand/10" : failed || cancelled ? "bg-mango/10" : "bg-white border border-inkdeep/10"
          }`}
        >
          <Text className="text-lg font-bold text-brand-deep">{banner.title}</Text>
          <Text className="mt-1 text-xs text-inkdeep/60">Order #{o.id.slice(0, 8).toUpperCase()}</Text>
          <Text className="mt-1 text-xs text-inkdeep/60">{banner.body}</Text>

          {awaitingPayment && paymentIntent ? (
            checkout.available ? (
              <Pressable
                onPress={() => checkout.open(paymentIntent, o.id)}
                disabled={checkout.status === "opening"}
                className="mt-3 self-start rounded-full bg-brand px-4 py-2"
                testID="complete-payment"
              >
                <Text className="text-xs font-semibold text-white">
                  {checkout.status === "opening" ? "Opening…" : "Complete payment"}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => order.refetch()}
                className="mt-3 self-start rounded-full border border-brand px-4 py-2"
                testID="check-payment"
              >
                <Text className="text-xs font-semibold text-brand">Check payment status</Text>
              </Pressable>
            )
          ) : null}

          {(failed || cancelled) ? (
            <Link href="/" className="mt-3 text-xs font-semibold text-brand">
              Start a new order
            </Link>
          ) : null}
        </View>

        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-inkdeep/50">Items</Text>
        <View className="rounded-xl border border-inkdeep/10 bg-white">
          {o.items.map((it, i) => (
            <View
              key={it.id}
              className={`flex-row justify-between px-4 py-3 ${i > 0 ? "border-t border-inkdeep/10" : ""}`}
            >
              <Text className="flex-1 pr-2 text-sm text-inkdeep" numberOfLines={2}>
                {it.name} <Text className="text-inkdeep/50">× {it.qty}</Text>
              </Text>
              <Text className="text-sm text-inkdeep">{rupees(it.unitPrice * it.qty)}</Text>
            </View>
          ))}
        </View>

        <View className="mt-4 rounded-xl border border-inkdeep/10 bg-white p-4">
          <Row label="Subtotal" value={rupees(o.subtotal)} />
          {o.discount > 0 ? <Row label="Discount" value={`− ${rupees(o.discount)}`} /> : null}
          <Row label="Delivery fee" value={rupees(o.deliveryFee)} />
          {o.walletApplied > 0 ? <Row label="Wallet applied" value={`− ${rupees(o.walletApplied)}`} /> : null}
          <View className="my-2 h-px bg-inkdeep/10" />
          <Row label={o.payable === 0 ? "Paid by wallet" : "Payable"} value={rupees(o.payable)} bold />
          {o.refundedAmount > 0 ? <Row label="Refunded to wallet" value={`+ ${rupees(o.refundedAmount)}`} /> : null}
        </View>

        <Link href="/" className="mt-6 text-center font-semibold text-brand">
          Back to catalog
        </Link>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between py-0.5">
      <Text className={`text-sm ${bold ? "font-bold text-inkdeep" : "text-inkdeep/60"}`}>{label}</Text>
      <Text className={`text-sm ${bold ? "font-bold text-brand-deep" : "text-inkdeep"}`}>{value}</Text>
    </View>
  );
}
