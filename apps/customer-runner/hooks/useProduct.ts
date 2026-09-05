/**
 * One product, for the detail screen.
 *
 * The interesting part is `initialData`. A customer arrives here by
 * tapping a tile, which means the catalog (or a search result) already
 * holds every field this screen needs. Seeding from that cache means the
 * detail screen paints complete on the first frame - image, name, price,
 * availability - and then revalidates in the background.
 *
 * That is the whole prefetch strategy for this slice, and it is better
 * than an actual prefetch: no speculative request is issued for products
 * the customer never opens, and the common path costs zero requests.
 * §32's "do not prefetch the entire catalog" is satisfied by not
 * prefetching anything.
 *
 * `initialDataUpdatedAt` is what makes it honest. Without it the seeded
 * value would be treated as freshly fetched and left unrevalidated for a
 * full staleTime; with it, TanStack knows the data is exactly as old as
 * the catalog fetch it came from and refetches on mount when that is
 * stale. Availability is the field that matters here - a product that
 * sold out since the catalog loaded must not stay green on this screen.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { CatalogProduct } from "./useCatalog";
import { supabase } from "../lib/supabase";

export function useProduct(productId: string | undefined) {
  const qc = useQueryClient();

  return useQuery({
    queryKey: ["product", productId],
    enabled: !!productId,
    staleTime: 60_000,
    retry: 2,

    initialData: () => {
      if (!productId) return undefined;
      const cached = qc.getQueryData<CatalogProduct[]>(["catalog"]);
      return cached?.find((p) => p.id === productId);
    },
    initialDataUpdatedAt: () => qc.getQueryState(["catalog"])?.dataUpdatedAt,

    queryFn: async (): Promise<CatalogProduct> => {
      const { data, error } = await supabase
        .from("products_with_availability")
        .select("id, name, brand, image_url, mrp, sale_price, unit_label, category, is_available")
        .eq("id", productId!)
        // `maybeSingle` rather than `single`: an id that is real but no
        // longer listed returns zero rows, and that is a "not found" to
        // render, not an exception to throw. The view already excludes
        // unlisted products, so this is a reachable state via a stale
        // deep link.
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("This product is no longer available.");

      return {
        id: data.id!,
        name: data.name!,
        brand: data.brand,
        imageUrl: data.image_url,
        mrp: data.mrp!,
        salePrice: data.sale_price!,
        unitLabel: data.unit_label,
        category: data.category!,
        isAvailable: data.is_available ?? false,
      };
    },
  });
}
