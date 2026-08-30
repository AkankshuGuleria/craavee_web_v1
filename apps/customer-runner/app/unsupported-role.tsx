import { Pressable, Text, View } from "react-native";

import { useAuth } from "../lib/auth/AuthProvider";

/**
 * Reached only for an authenticated session whose role claim is
 * `packer`/`admin` (RBAC_MATRIX.md §1's other two roles — real roles in
 * the system, just not ones this app has a surface for; those staff use
 * Store/Console). Phase 3 §7's "safe default behavior" for that case:
 * never render either the customer or runner experience for a role that
 * is neither.
 */
export default function UnsupportedRoleScreen() {
  const { signOut } = useAuth();

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-paper px-6">
      <Text className="text-center text-lg font-semibold text-inkdeep">
        This account isn't set up as a customer or runner.
      </Text>
      <Text className="text-center text-inkdeep/70">
        Staff accounts use the Store or Console apps instead.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => signOut()}
        className="rounded-lg bg-brand px-6 py-3"
      >
        <Text className="text-base font-semibold text-paper">Sign out</Text>
      </Pressable>
    </View>
  );
}
