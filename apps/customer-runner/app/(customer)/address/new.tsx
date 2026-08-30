import { useState } from "react";

import { Stack, router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { useCreateAddress, useZones } from "../../../hooks/useAddresses";

/**
 * Add a structured campus address — Phase 4 prompt §5, D15.
 *
 * Zone (from the serviceable list) + block/hostel + floor + room, plus an
 * optional landmark for runner-readability only. NO free-text delivery
 * address. The insert goes through the `addresses` RLS
 * `with check (customer_id = auth.uid())` policy.
 */
export default function NewAddressScreen() {
  const zones = useZones();
  const create = useCreateAddress();

  const [zoneId, setZoneId] = useState<string | null>(null);
  const [block, setBlock] = useState("");
  const [floor, setFloor] = useState("");
  const [room, setRoom] = useState("");
  const [landmark, setLandmark] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const canSave = !!zoneId && block.trim().length > 0 && room.trim().length > 0 && !create.isPending;

  async function save() {
    if (!canSave) return;
    setErr(null);
    try {
      await create.mutateAsync({
        zoneId: zoneId!,
        block,
        floor: floor || undefined,
        room,
        landmark: landmark || undefined,
        isDefault: makeDefault,
      });
      router.back();
    } catch {
      setErr("Couldn't save that address. Please check the details and try again.");
    }
  }

  return (
    <View className="flex-1 bg-paper">
      <Stack.Screen options={{ title: "New address", headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-inkdeep/50">Zone</Text>
        {zones.isPending ? (
          <ActivityIndicator />
        ) : (
          (zones.data ?? []).map((z) => (
            <Pressable
              key={z.id}
              onPress={() => setZoneId(z.id)}
              disabled={!z.isServiceable}
              className={`mb-2 rounded-xl border p-3 ${
                zoneId === z.id ? "border-brand bg-brand/5" : "border-inkdeep/10 bg-white"
              } ${z.isServiceable ? "" : "opacity-40"}`}
              testID={`zone-${z.id}`}
            >
              <Text className="text-sm font-semibold text-inkdeep">{z.name}</Text>
              <Text className="mt-0.5 text-xs text-inkdeep/60">
                Delivery ₹{(z.deliveryFee / 100).toFixed(2)}
                {z.isServiceable ? "" : " · not serviceable"}
              </Text>
            </Pressable>
          ))
        )}

        <Field label="Block / hostel" value={block} onChangeText={setBlock} placeholder="e.g. Hostel C" testID="field-block" />
        <Field label="Floor (optional)" value={floor} onChangeText={setFloor} placeholder="e.g. 3" testID="field-floor" />
        <Field label="Room" value={room} onChangeText={setRoom} placeholder="e.g. 312" testID="field-room" />
        <Field
          label="Landmark (optional, for the runner)"
          value={landmark}
          onChangeText={setLandmark}
          placeholder="e.g. Opposite the water cooler"
          testID="field-landmark"
        />

        <Pressable
          onPress={() => setMakeDefault((v) => !v)}
          className="mb-4 mt-1 flex-row items-center gap-2"
          testID="make-default"
        >
          <View
            className={`h-5 w-5 items-center justify-center rounded border ${
              makeDefault ? "border-brand bg-brand" : "border-inkdeep/30"
            }`}
          >
            {makeDefault ? <Text className="text-xs font-bold text-white">✓</Text> : null}
          </View>
          <Text className="text-sm text-inkdeep">Set as my default address</Text>
        </Pressable>

        {err ? <Text className="mb-3 text-xs font-semibold text-mango">{err}</Text> : null}

        <Pressable
          onPress={save}
          disabled={!canSave}
          className={`items-center rounded-2xl px-5 py-4 ${canSave ? "bg-brand" : "bg-inkdeep/20"}`}
          testID="save-address"
        >
          <Text className="text-base font-semibold text-white">
            {create.isPending ? "Saving…" : "Save address"}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  testID: string;
}) {
  return (
    <View className="mt-3">
      <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-inkdeep/50">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        className="rounded-xl border border-inkdeep/10 bg-white px-3 py-2 text-inkdeep"
        testID={testID}
      />
    </View>
  );
}
