import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { useActiveJob, useClaimJob, useRunnerQueue, type QueueJob } from "../../hooks/useRunnerJobs";
import { toRunnerUiError } from "../../lib/runner/errors";
import { supabase } from "../../lib/supabase";
import { useState } from "react";

/**
 * Runner queue — Phase 7 §5/§17.
 *
 * Built for one-handed use on a phone in the street: large targets, one
 * action per row, no horizontal scrolling and no map. The runner is
 * moving; every extra tap is a real cost.
 *
 * If the runner already holds a job the queue is not shown at all — they
 * cannot claim a second one (the database refuses it), so offering the
 * list would only produce a guaranteed error.
 */
function addressLine(j: QueueJob) {
  const parts = [j.block && `Block ${j.block}`, j.floor && `Floor ${j.floor}`, j.room && `Room ${j.room}`];
  return parts.filter(Boolean).join(" · ");
}

export default function RunnerQueueScreen() {
  const router = useRouter();
  const queue = useRunnerQueue();
  const active = useActiveJob();
  const claim = useClaimJob();
  const [error, setError] = useState<string | null>(null);

  // The runner already has work: send them straight to it.
  if (active.data) {
    return (
      <View className="flex-1 justify-center gap-6 bg-paper px-6">
        <Text className="text-2xl font-bold text-brand-deep">You have a live job</Text>
        <Text className="text-base text-inkdeep/70">
          Finish or release your current delivery before claiming another.
        </Text>
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-2xl bg-brand py-5"
          onPress={() => router.push("/(runner)/active")}
        >
          <Text className="text-lg font-semibold text-white">Go to my delivery</Text>
        </Pressable>
      </View>
    );
  }

  const jobs = queue.data ?? [];

  return (
    <View className="flex-1 bg-paper">
      <View className="flex-row items-center justify-between px-5 pb-3 pt-16">
        <Text className="text-2xl font-bold text-brand-deep">Available jobs</Text>
        <Pressable accessibilityRole="button" onPress={() => supabase.auth.signOut()}>
          <Text className="text-base font-semibold text-brand">Log out</Text>
        </Pressable>
      </View>

      {error ? (
        <Text className="px-5 pb-2 text-base text-danger">{error}</Text>
      ) : null}

      <ScrollView
        contentContainerClassName="gap-3 px-4 pb-10"
        refreshControl={
          <RefreshControl refreshing={queue.isFetching} onRefresh={() => queue.refetch()} />
        }
      >
        {queue.isLoading ? (
          <View className="items-center py-16">
            <ActivityIndicator />
          </View>
        ) : jobs.length === 0 ? (
          <View className="items-center gap-2 py-16">
            <Text className="text-lg font-semibold text-inkdeep">No jobs right now</Text>
            <Text className="text-base text-inkdeep/60">Pull down to refresh.</Text>
          </View>
        ) : (
          jobs.map((j) => (
            <View key={j.id} className="gap-3 rounded-2xl bg-white p-4">
              <View className="gap-1">
                <Text className="text-lg font-semibold text-inkdeep">{addressLine(j) || "Address on claim"}</Text>
                {j.landmark ? <Text className="text-base text-inkdeep/60">{j.landmark}</Text> : null}
                <Text className="text-base text-inkdeep/60">
                  {j.itemCount} {j.itemCount === 1 ? "item" : "items"}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={claim.isPending}
                className={`items-center rounded-2xl py-5 ${claim.isPending ? "bg-brand/40" : "bg-brand"}`}
                onPress={async () => {
                  setError(null);
                  try {
                    await claim.mutateAsync({ orderId: j.id });
                    router.push("/(runner)/active");
                  } catch (e) {
                    const ui = toRunnerUiError((e as { code?: string }).code);
                    setError(`${ui.title}: ${ui.message}`);
                    // A lost race means the list is stale — refresh it so
                    // the runner is not staring at a job that is gone.
                    if (ui.losable) queue.refetch();
                  }
                }}
              >
                <Text className="text-lg font-semibold text-white">
                  {claim.isPending ? "Claiming…" : "Claim"}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
