"use client";

import { useState } from "react";
import {
  Crosshair,
  MapPin,
  X,
  Spinner,
  Check,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useAddress, type DeliveryAddress } from "@/components/providers";
import { cn } from "@/lib/utils";

const EMPTY = { line: "", area: "", city: "", pincode: "" };

export function AddressSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { address, saveAddress } = useAddress();
  const reduce = useReducedMotion();
  const [form, setForm] = useState(EMPTY);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setError("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        let line = "Current location";
        let city = "";
        let area = "";
        let pincode = "";
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${coords.lat}&longitude=${coords.lng}&localityLanguage=en`
          );
          const data = await res.json();
          line =
            [data.localityInfo?.administrative?.[3]?.name, data.locality]
              .filter(Boolean)[0] || data.city || "Current location";
          city = data.city || data.principalSubdivision || "";
          area = data.locality || "";
          pincode = data.postcode || "";
        } catch {
          /* reverse geocode failed — coords still usable */
        }
        saveAddress({
          label: "Current location",
          line,
          area: area !== line ? area : "",
          city,
          pincode,
          coords,
        });
        setLocating(false);
        onClose();
      },
      () => {
        setLocating(false);
        setError(
          "Couldn't get your location. Allow access or enter the address below."
        );
      },
      { timeout: 12000 }
    );
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.line.trim()) return;
    saveAddress({
      label: form.city ? form.city : "Home",
      line: form.line.trim(),
      area: form.area.trim(),
      city: form.city.trim(),
      pincode: form.pincode.trim(),
    });
    setForm(EMPTY);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={onClose}
        >
          <motion.div
            initial={reduce ? undefined : { y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-surface w-full max-w-md rounded-t-[28px] p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.9)] sm:rounded-[28px]"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-lg font-extrabold tracking-tight text-white">
                Where should it land?
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-white/[0.08] text-white/55 transition-colors hover:bg-white/15 hover:text-white"
              >
                <X size={15} weight="bold" />
              </button>
            </div>

            {address && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl bg-orange-400/10 p-3.5 ring-1 ring-inset ring-orange-400/20">
                <MapPin
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0 text-orange-300"
                />
                <p className="text-xs leading-relaxed text-white/65">
                  <span className="font-bold text-white">{address.label}</span> ·{" "}
                  {formatShort(address)}
                </p>
              </div>
            )}

            <button
              onClick={useCurrentLocation}
              disabled={locating}
              className="btn-clay flex w-full cursor-pointer items-center justify-center gap-2 px-5 py-3.5 font-display text-sm font-bold disabled:opacity-70"
            >
              {locating ? (
                <Spinner size={18} weight="bold" className="animate-spin" />
              ) : (
                <Crosshair size={18} weight="bold" />
              )}
              {locating ? "Finding you…" : "Use my current location"}
            </button>

            <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">
              <span className="h-0.5 flex-1 rounded-full bg-white/10" />
              or enter manually
              <span className="h-0.5 flex-1 rounded-full bg-white/10" />
            </div>

            <form onSubmit={submitForm} className="space-y-3">
              <input
                value={form.line}
                onChange={(e) => setForm({ ...form, line: e.target.value })}
                placeholder="House / Flat no., Street"
                aria-label="House, flat number and street"
                required
                className="clay-input w-full px-4 py-3 text-sm text-white/90 placeholder:text-white/35"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                  placeholder="Area / Locality"
                  aria-label="Area or locality"
                  className="clay-input w-full px-4 py-3 text-sm text-white/90 placeholder:text-white/35"
                />
                <input
                  value={form.pincode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                    })
                  }
                  inputMode="numeric"
                  placeholder="Pincode"
                  aria-label="Pincode"
                  className="clay-input w-full px-4 py-3 text-sm text-white/90 placeholder:text-white/35"
                />
              </div>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="City"
                aria-label="City"
                className={cn(
                  "clay-input w-full px-4 py-3 text-sm text-white/90 placeholder:text-white/35"
                )}
              />

              {error && <p className="text-xs font-medium text-rose-400">{error}</p>}

              <button
                type="submit"
                disabled={!form.line.trim()}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-5 py-3.5 font-display text-sm font-bold text-emerald-300 transition-[background-color,border-color,color,box-shadow,transform] hover:bg-emerald-500 hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check size={16} weight="bold" />
                Save address
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function formatShort(a: DeliveryAddress): string {
  const parts = [a.line, a.area, a.city].filter(Boolean);
  return parts.join(", ");
}