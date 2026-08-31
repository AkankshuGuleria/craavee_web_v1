import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useActiveJob, useMarkDeliveryFailed, useMarkPickedUp, useReleaseJob, useVerifyDeliveryCode } from "../../hooks/useRunnerJobs";
import { useRunnerRealtime, useRunnerStore } from "../../hooks/useRunnerRealtime";
import { toRunnerUiError } from "../../lib/runner/errors";

/**
 * Active job — pickup then delivery. Phase 7 §17.
 *
 * The screen shows exactly one action at a time, chosen by the order's
 * server-side status: `assigned` -> "Picked up", `picked_up` -> enter the
 * delivery code. The runner never picks which transition to attempt, so
 * they cannot be shown a button that is guaranteed to fail.
 *
 * The status comes from the server on every refetch and is never held in
 * a client store (§18). No map, no GPS — out of scope and not needed to
 * find a block/floor/room on a campus.
 */
export default function ActiveJobScreen() {
  const router = useRouter();
  const active = useActiveJob();
  const pickup = useMarkPickedUp();
  const release = useReleaseJob();
  const verify = useVerifyDeliveryCode();
  const failed = useMarkDeliveryFailed();
  // Reassignment or an admin release while the runner is mid-job must
  // show up here without a manual refresh (§20).
  const storeId = useRunnerStore();
  useRunnerRealtime(storeId);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showFail, setShowFail] = useState(false);
  const [reason, setReason] = useState("");

  if (active.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }

  if (done || !active.data) {
    return (
      <View className="flex-1 justify-center gap-6 bg-paper px-6">
        <Text className="text-2xl font-bold text-brand-deep">
          {done ? "Delivered" : "No live job"}
        </Text>
        <Text className="text-base text-inkdeep/70">
          {done ? "Nice work. Ready for the next one." : "Claim a job from the queue to get started."}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-brand py-5"
          onPress={() => {
            setDone(false);
            router.replace("/(runner)");
          }}
        >
          <Text className="text-lg font-semibold text-white">Back to jobs</Text>
        </Pressable>
      </View>
    );
  }

  const job = active.data;
  const addr = [job.block && `Block ${job.block}`, job.floor && `Floor ${job.floor}`, job.room && `Room ${job.room}`]
    .filter(Boolean)
    .join(" · ");

  async function run(fn: () => Promise<unknown>, onOk?: () => void) {
    setError(null);
    try {
      await fn();
      onOk?.();
    } catch (e) {
      const ui = toRunnerUiError((e as { code?: string }).code);
      setError(`${ui.title}: ${ui.message}`);
      if (ui.losable) active.refetch();
    }
  }

  return (
    <ScrollView contentContainerClassName="gap-6 px-6 pb-12 pt-16" className="flex-1 bg-paper">
      <View className="gap-2">
        <Text className="text-2xl font-bold text-brand-deep">Your delivery</Text>
        <Text className="text-xl font-semibold text-inkdeep">{addr || "Address unavailable"}</Text>
        {job.landmark ? <Text className="text-base text-inkdeep/60">{job.landmark}</Text> : null}
        <Text className="text-base text-inkdeep/60">
          {job.itemCount} {job.itemCount === 1 ? "item" : "items"}
        </Text>
      </View>

      {error ? <Text className="text-base text-danger">{error}</Text> : null}

      {job.status === "assigned" ? (
        <View className="gap-4">
          <Pressable
            accessibilityRole="button"
            disabled={pickup.isPending}
            className={`items-center rounded-2xl py-6 ${pickup.isPending ? "bg-brand/40" : "bg-brand"}`}
            onPress={() => run(() => pickup.mutateAsync({ orderId: job.id }))}
          >
            <Text className="text-xl font-semibold text-white">
              {pickup.isPending ? "Confirming…" : "Picked up"}
            </Text>
          </Pressable>

          {/* Release is only offered before pickup: once the runner holds
              the bag there is no legal path back to the queue. */}
          <Pressable
            accessibilityRole="button"
            disabled={release.isPending}
            className="items-center rounded-2xl border border-inkdeep/20 py-5"
            onPress={() =>
              run(
                () => release.mutateAsync({ orderId: job.id, reason: "runner released" }),
                () => router.replace("/(runner)"),
              )
            }
          >
            <Text className="text-lg font-semibold text-inkdeep">
              {release.isPending ? "Releasing…" : "Can't take this job"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-4">
          <Text className="text-base text-inkdeep/70">
            Ask the customer for their 4-digit delivery code.
          </Text>
          <TextInput
            className="rounded-2xl border border-inkdeep/15 bg-white px-5 py-5 text-center text-3xl tracking-[12px] text-inkdeep"
            keyboardType="number-pad"
            maxLength={4}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
            placeholder="0000"
            accessibilityLabel="Delivery code"
          />
          <Pressable
            accessibilityRole="button"
            disabled={code.length !== 4 || verify.isPending}
            className={`items-center rounded-2xl py-6 ${code.length !== 4 || verify.isPending ? "bg-brand/40" : "bg-brand"}`}
            onPress={() =>
              run(
                () => verify.mutateAsync({ orderId: job.id, code }),
                () => {
                  setCode("");
                  setDone(true);
                },
              )
            }
          >
            <Text className="text-xl font-semibold text-white">
              {verify.isPending ? "Checking…" : "Confirm delivery"}
            </Text>
          </Pressable>

          {/* Phase 8: the exit that did not exist. After pickup the only
              legal moves are `delivered` and `delivery_failed` — release
              cannot reach `packed` from here — so without this a runner
              holding an undeliverable bag was stuck. An admin decides
              afterwards whether to reassign or cancel; reporting a
              failure refunds nothing by itself (#12). */}
          {!showFail ? (
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-2xl border border-inkdeep/20 py-5"
              onPress={() => setShowFail(true)}
            >
              <Text className="text-lg font-semibold text-inkdeep">Can&apos;t deliver this</Text>
            </Pressable>
          ) : (
            <View className="gap-3 rounded-2xl border border-inkdeep/15 p-4">
              <Text className="text-base font-semibold text-inkdeep">What happened?</Text>
              <TextInput
                className="rounded-xl border border-inkdeep/15 bg-white px-4 py-4 text-base text-inkdeep"
                placeholder="e.g. customer not answering"
                value={reason}
                onChangeText={setReason}
                multiline
                accessibilityLabel="Reason delivery failed"
              />
              <Pressable
                accessibilityRole="button"
                disabled={reason.trim().length === 0 || failed.isPending}
                className={`items-center rounded-2xl py-5 ${reason.trim().length === 0 || failed.isPending ? "bg-danger/40" : "bg-danger"}`}
                onPress={() =>
                  run(
                    () => failed.mutateAsync({ orderId: job.id, reason: reason.trim() }),
                    () => {
                      setShowFail(false);
                      setReason("");
                      router.replace("/(runner)");
                    },
                  )
                }
              >
                <Text className="text-lg font-semibold text-white">
                  {failed.isPending ? "Reporting…" : "Report delivery failed"}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setShowFail(false)}>
                <Text className="text-center text-base text-inkdeep/60">Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
