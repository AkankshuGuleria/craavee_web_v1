/**
 * The one way a product is pictured, anywhere in the customer app.
 *
 * Three states, all deliberate:
 *
 *   loaded   the real image, cover-fit inside a fixed aspect ratio
 *   absent   `imageUrl` is null - the catalog simply has no picture yet
 *   failed   there was a URL and it did not load
 *
 * `absent` and `failed` are NOT the same thing and must not look the
 * same. Staging currently has no image URLs at all, so every tile is in
 * the `absent` state; that has to read as "this is how Craavee looks
 * before photography", not as "something broke". A failed load, by
 * contrast, should be quietly legible as a failure.
 *
 * The fallback is drawn from tokens - a monogram on the brand-soft
 * ground - rather than shipping a placeholder asset. No image is
 * fabricated, downloaded, or hot-linked to fake a product photo.
 *
 * Layout stability is the other job. The box reserves its space from the
 * first frame via `aspectRatio`, so a late-arriving image never reflows
 * the grid around it. That is what stops the catalog jumping while
 * scrolling.
 */
import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

import { theme, font } from "../../lib/theme";

/** First letter of the product, used as the no-photo monogram. */
function monogram(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "·";
}

export function ProductImage({
  uri,
  name,
  rounded = 16,
  aspectRatio = 1,
  /** Monogram size. The tile and the detail hero want very different weights. */
  scale = "sm",
}: {
  uri: string | null;
  name: string;
  rounded?: number;
  aspectRatio?: number;
  scale?: "sm" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = !uri || failed;

  return (
    <View
      style={{
        width: "100%",
        aspectRatio,
        borderRadius: rounded,
        overflow: "hidden",
        backgroundColor: showFallback ? theme.brandSoft : theme.surfaceAlt,
      }}
      // The image is decorative *only* when there is a real photo: the
      // product name is always rendered as text right beside it, so
      // announcing it twice is noise. The fallback carries no information
      // at all, so it is hidden from assistive tech outright.
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {showFallback ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text
            style={{
              color: theme.brand,
              fontSize: scale === "lg" ? 64 : 26,
              lineHeight: scale === "lg" ? 72 : 32,
              fontWeight: font.weight.bold,
              opacity: failed ? 0.35 : 0.55,
            }}
          >
            {monogram(name)}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          // Fade only on a genuine network fetch; a memory-cache hit
          // should appear instantly rather than fading in every scroll.
          transition={200}
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}
