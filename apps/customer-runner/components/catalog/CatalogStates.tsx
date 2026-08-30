import { Pressable, Text, View } from "react-native";

/** Static placeholder rows shown while the first catalog fetch is in flight. */
export function CatalogSkeleton() {
  return (
    <View className="gap-3 px-4 pt-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} className="h-[104px] flex-row gap-3 rounded-xl bg-white p-3">
          <View className="h-20 w-20 rounded-lg bg-inkdeep/10" />
          <View className="flex-1 justify-center gap-2">
            <View className="h-4 w-3/4 rounded bg-inkdeep/10" />
            <View className="h-3 w-1/2 rounded bg-inkdeep/10" />
            <View className="h-4 w-1/3 rounded bg-inkdeep/10" />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CatalogEmptyState() {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-6 py-16">
      <Text className="text-lg font-semibold text-inkdeep">Nothing here yet</Text>
      <Text className="text-center text-inkdeep/60">
        This store hasn't listed any products.
      </Text>
    </View>
  );
}

export function CatalogErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6 py-16">
      <Text className="text-lg font-semibold text-inkdeep">Couldn't load the catalog</Text>
      <Text className="text-center text-inkdeep/60">
        Check your connection and try again.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className="rounded-lg bg-brand px-5 py-2.5"
        testID="catalog-retry-button"
      >
        <Text className="font-semibold text-paper">Retry</Text>
      </Pressable>
    </View>
  );
}
