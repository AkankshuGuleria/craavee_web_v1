import { useMemo, useState } from "react";

import { Link, router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { rupees } from "../../lib/format";
import { useAddresses } from "../../hooks/useAddresses";
import { useCart } from "../../hooks/useCart";
import { useCreateOrder } from "../../hooks/useCreateOrder";
import { useProfile } from "../../hooks/useProfile";
import { useValidatePromo } from "../../hooks/useValidatePromo";

/**
 * Checkout — Phase 4 prompt §12/§13/§20/§21/§28.
 *
 * The customer chooses an address, optionally a promo code and the
 * wallet, then taps "Place order". Everything shown before that tap is
 * INDICATIVE (promo preview via the advisory `validate_promo`, wallet
 * shown from the read-only profile). The moment "Place order" runs,
 * `create_order`'s response is the ONLY authoritative summary and the
 * customer is taken to the order screen. A stale-cart / invalid-choice
 * error is shown as a correction state — nothing is silently changed.
 */
export default function CheckoutScreen() {
  const cart = useCart();
  const { data: profile } = useProfile();
  const addresses = useAddresses();
  const { submit, status, error, errorCode, resetAttempt } = useCreateOrder();
  const promoMut = useValidatePromo();

  // null = "no explicit pick yet, use the default". Derived below rather
  // than synced via an effect.
  const [pickedAddressId, setPickedAddressId] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [useWallet, setUseWallet] = useState(false);

  const addressId =
    pickedAddressId ??
    addresses.data?.find((a) => a.isDefault)?.id ??
    addresses.data?.[0]?.id ??
    null;
  const setAddressId = setPickedAddressId;

  const selectedAddress = addresses.data?.find((a) => a.id === addressId) ?? null;
  const walletBalance = profile?.wallet_balance ?? 0;

  const preview = useMemo(() => {
    const discount = appliedPromo && promoMut.data?.valid ? promoMut.data.discountAmount : 0;
    const deliveryFee = selectedAddress?.deliveryFee ?? 0;
    const beforeWallet = Math.max(0, cart.indicativeSubtotal - discount + deliveryFee);
    const walletApplied = useWallet ? Math.min(walletBalance, beforeWallet) : 0;
    return {
      discount,
      deliveryFee,
      walletApplied,
      payable: beforeWallet - walletApplied,
    };
  }, [appliedPromo, promoMut.data, selectedAddress, cart.indicativeSubtotal, useWallet, walletBalance]);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    const res = await promoMut.mutateAsync({ code, orderSubtotal: cart.indicativeSubtotal });
    setAppliedPromo(res.valid ? code : null);
  }

  async function placeOrder() {
    if (!addressId) return;
    const created = await submit({
      addressId,
      promoCode: appliedPromo ?? undefined,
      useWallet,
    });
    if (!created) return;
    // Carry the server-built payment intent to the order screen so it can
    // open the gateway's hosted checkout (Phase 5 §16). A fully
    // wallet-covered order has no `paymentIntent` and is already
    // `confirmed`.
    router.replace({
      pathname: "/order/[id]",
      params: {
        id: created.orderId,
        ...(created.paymentIntent ? { pi: JSON.stringify(created.paymentIntent) } : {}),
      },
    });
  }

  if (cart.isEmpty) {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <Text className="text-sm text-inkdeep/60">Your cart is empty.</Text>
        <Link href="/" className="mt-3 font-semibold text-brand">
          Back to catalog
        </Link>
      </View>
    );
  }

  const showCorrection = status === "error" && error?.needsCorrection;

  return (
    <View className="flex-1 bg-paper">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
        {status === "error" && error ? (
          <View
            className={`mb-4 rounded-xl border p-3 ${
              showCorrection ? "border-mango/40 bg-mango/10" : "border-inkdeep/15 bg-white"
            }`}
          >
            <Text className="text-sm font-semibold text-inkdeep">{error.title}</Text>
            <Text className="mt-1 text-xs text-inkdeep/70">{error.message}</Text>
            {error.retryable && !showCorrection ? (
              <Pressable
                onPress={placeOrder}
                className="mt-2 self-start rounded-full bg-brand px-4 py-1.5"
                testID="retry-order"
              >
                <Text className="text-xs font-semibold text-white">Retry</Text>
              </Pressable>
            ) : null}
            {errorCode === "ORDER_ALREADY_EXISTS" ? (
              <Pressable onPress={resetAttempt} className="mt-2 self-start" testID="new-checkout">
                <Text className="text-xs font-semibold text-brand">Start a new checkout</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* ---- address ---- */}
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-inkdeep/50">Deliver to</Text>
        {addresses.isPending ? (
          <ActivityIndicator />
        ) : addresses.data && addresses.data.length > 0 ? (
          addresses.data.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setAddressId(a.id)}
              className={`mb-2 rounded-xl border p-3 ${
                addressId === a.id ? "border-brand bg-brand/5" : "border-inkdeep/10 bg-white"
              }`}
              testID={`address-${a.id}`}
            >
              <Text className="text-sm font-semibold text-inkdeep">
                {a.block}
                {a.floor ? `, Floor ${a.floor}` : ""}, Room {a.room}
              </Text>
              <Text className="mt-0.5 text-xs text-inkdeep/60">
                {a.zoneName} · delivery {rupees(a.deliveryFee)}
                {a.isServiceable ? "" : " · not serviceable"}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text className="text-sm text-inkdeep/60">No saved address yet.</Text>
        )}
        <Link href="/address/new" className="mb-4 mt-1 text-sm font-semibold text-brand">
          + Add a new address
        </Link>

        {/* ---- promo ---- */}
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-inkdeep/50">Promo code</Text>
        <View className="mb-1 flex-row gap-2">
          <TextInput
            value={promoInput}
            onChangeText={setPromoInput}
            autoCapitalize="characters"
            placeholder="Enter code"
            className="flex-1 rounded-xl border border-inkdeep/10 bg-white px-3 py-2 text-inkdeep"
            testID="promo-input"
          />
          <Pressable
            onPress={applyPromo}
            disabled={promoMut.isPending || !promoInput.trim()}
            className="items-center justify-center rounded-xl bg-brand-deep px-4"
            testID="apply-promo"
          >
            <Text className="text-sm font-semibold text-white">{promoMut.isPending ? "…" : "Apply"}</Text>
          </Pressable>
        </View>
        {promoMut.data ? (
          promoMut.data.valid ? (
            <Text className="mb-4 text-xs font-semibold text-brand">
              Promo applied — {rupees(promoMut.data.discountAmount)} off (confirmed at checkout)
            </Text>
          ) : (
            <Text className="mb-4 text-xs font-semibold text-mango">That code can't be applied.</Text>
          )
        ) : (
          <View className="mb-4" />
        )}

        {/* ---- wallet ---- */}
        <View className="mb-4 flex-row items-center justify-between rounded-xl border border-inkdeep/10 bg-white p-3">
          <View>
            <Text className="text-sm font-semibold text-inkdeep">Use wallet balance</Text>
            <Text className="mt-0.5 text-xs text-inkdeep/60">Available: {rupees(walletBalance)}</Text>
          </View>
          <Switch
            value={useWallet}
            onValueChange={setUseWallet}
            disabled={walletBalance <= 0}
            testID="wallet-toggle"
          />
        </View>

        {/* ---- summary (indicative) ---- */}
        <View className="rounded-xl border border-inkdeep/10 bg-white p-4">
          <Row label="Subtotal" value={rupees(cart.indicativeSubtotal)} />
          {preview.discount > 0 ? <Row label="Promo discount" value={`− ${rupees(preview.discount)}`} /> : null}
          <Row label="Delivery fee" value={rupees(preview.deliveryFee)} />
          {preview.walletApplied > 0 ? (
            <Row label="Wallet" value={`− ${rupees(preview.walletApplied)}`} />
          ) : null}
          <View className="my-2 h-px bg-inkdeep/10" />
          <Row label="Payable now (indicative)" value={rupees(preview.payable)} bold />
          <Text className="mt-2 text-[11px] text-inkdeep/50">
            The store confirms the final amount when it accepts your order.
          </Text>
        </View>
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-inkdeep/10 bg-white px-4 pb-8 pt-3">
        <Pressable
          accessibilityRole="button"
          disabled={!addressId || status === "submitting"}
          onPress={placeOrder}
          className={`items-center rounded-2xl px-5 py-4 ${
            addressId && status !== "submitting" ? "bg-brand" : "bg-inkdeep/20"
          }`}
          testID="place-order"
        >
          <Text className="text-base font-semibold text-white">
            {status === "submitting" ? "Placing order…" : "Place order"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A label/amount line in the order summary.
 *
 * `flex-1` on the label and `shrink-0` on the amount are load-bearing on
 * Android, not cosmetic. Without them this row rendered "Subtota" for
 * "Subtotal", "Delivery" for "Delivery fee" and "₹19.0" for "₹19.00" on a
 * physical vivo V2250 (Android 15, font_scale 1.0) - money, silently
 * wrong-looking, on the screen where the customer is deciding to pay. Two
 * bare Texts in a `justify-between` row are each free to be measured
 * short; giving the label the flexible space and forbidding the amount to
 * shrink pins both. The trailing `pl-2` keeps the last glyph off the
 * measured edge, which is the same defect ProductCard's MRP hit.
 */
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between py-0.5">
      <Text className={`flex-1 text-sm ${bold ? "font-bold text-inkdeep" : "text-inkdeep/60"}`}>
        {label}
      </Text>
      <Text
        className={`shrink-0 pl-2 pr-1 text-sm ${bold ? "font-bold text-brand-deep" : "text-inkdeep"}`}
      >
        {value}
      </Text>
    </View>
  );
}
