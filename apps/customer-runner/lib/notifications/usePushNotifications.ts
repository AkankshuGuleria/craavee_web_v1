/**
 * Expo push registration and handling — Phase 8 §13/§14/§22/§23.
 *
 * Three jobs, in order of importance:
 *
 *   1. Register this device's token against the signed-in profile. The
 *      token is sent to `register_push_token`, which sets the owner from
 *      the verified JWT — the request has no profileId field, so a
 *      client cannot register a token against someone else's account.
 *   2. Drop the token on sign-out, so a shared or resold device stops
 *      receiving another person's order updates.
 *   3. On a notification tap, deep-link to the order and REFETCH it.
 *      The payload is a pointer, never state: §22's "do not blindly
 *      trust payload state". A stale notification therefore shows the
 *      current truth, not what was true when it was sent.
 *
 * Nothing here is required for correctness. A denied permission, a
 * missing projectId, or a push that never arrives leaves the order
 * lifecycle untouched — the customer's poll (D20) still shows the right
 * state. That is why every failure below is swallowed into a status
 * value rather than thrown.
 */
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";

import { supabase } from "../supabase";

export type PushStatus =
  | "idle"
  | "unsupported"     // simulator / web — no real APNs or FCM token exists
  | "denied"
  | "unconfigured"    // no EAS projectId, so Expo cannot mint a token
  | "registered"
  | "error";

/** Show a banner even when the app is foregrounded — an order update is
 *  worth interrupting a scroll for. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function currentProfileId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export function usePushNotifications(): PushStatus {
  const [status, setStatus] = useState<PushStatus>("idle");
  const router = useRouter();
  const qc = useQueryClient();
  const token = useRef<string | null>(null);

  // ---- registration -------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function register() {
      try {
        if (Platform.OS === "web") {
          if (!cancelled) setStatus("unsupported");
          return;
        }
        if (!(await currentProfileId())) return; // not signed in yet

        const existing = await Notifications.getPermissionsAsync();
        const granted =
          existing.granted ||
          (await Notifications.requestPermissionsAsync()).granted;
        if (!granted) {
          if (!cancelled) setStatus("denied");
          return;
        }

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("orders", {
            name: "Order updates",
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        // Requires an EAS projectId. Without one Expo cannot mint a
        // token at all, which is a configuration gap rather than a
        // failure — reported honestly instead of retried.
        const t = await Notifications.getExpoPushTokenAsync();
        token.current = t.data;

        const { data, error } = await supabase.functions.invoke("register_push_token", {
          body: { token: t.data, platform: Platform.OS === "ios" ? "ios" : "android" },
        });
        const envelope = (data ?? {}) as { ok?: boolean };
        if (!cancelled) setStatus(error || envelope.ok === false ? "error" : "registered");
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (cancelled) return;
        // Expo is explicit about both of these; neither is an error worth
        // alarming anyone about.
        if (/projectId|EAS/i.test(msg)) setStatus("unconfigured");
        else if (/simulator|physical device/i.test(msg)) setStatus("unsupported");
        else setStatus("error");
      }
    }

    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- sign-out cleanup ---------------------------------------------
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && token.current) {
        // push_tokens_delete allows a profile to delete its own rows, so
        // this needs no privileged endpoint. Best-effort: if it fails the
        // dispatcher will drop the token when Expo reports it dead.
        void supabase.from("push_tokens").delete().eq("token", token.current);
        token.current = null;
        setStatus("idle");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---- taps ----------------------------------------------------------
  useEffect(() => {
    function open(orderId: unknown) {
      if (typeof orderId !== "string" || orderId.length === 0) return;
      // Refetch before navigating: the notification may be minutes old,
      // and the order may have moved on since.
      qc.invalidateQueries({ queryKey: ["orders", orderId] });
      router.push({ pathname: "/(customer)/order/[id]", params: { id: orderId } });
    }

    // App was terminated and launched by the tap.
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      const data = r?.notification.request.content.data as { orderId?: unknown } | undefined;
      if (data?.orderId) open(data.orderId);
    });

    // App was backgrounded or foregrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as { orderId?: unknown } | undefined;
      open(data?.orderId);
    });
    return () => sub.remove();
  }, [router, qc]);

  return status;
}
