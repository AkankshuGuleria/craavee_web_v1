export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 ">
      <div className="clay-card flex items-center gap-4 px-8 py-6">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-green-600 font-display text-xl font-black text-white shadow-[0_8px_18px_-6px_rgba(22,163,74,0.5)]">
          C
        </span>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-full bg-green-500"
              style={{
                animation: "float-soft 0.9s ease-in-out infinite",
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>
      <p className="text-sm font-medium text-neutral-400">Packing your cravings…</p>
    </div>
  );
}