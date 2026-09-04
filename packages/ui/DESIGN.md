# Craavee Design System

The contract every Craavee surface is built against. Short on purpose —
a design document nobody finishes reading governs nothing.

**Source of truth: `@craavee/tokens`.** If a value is not in there, it is
not a design decision, it is a hard-coded number.

---

## 1. Principles

**Calm under pressure.** This product is used by a customer who is hungry,
a packer with a queue, and a runner on a bike. Nothing should demand
attention that has not earned it. No decorative motion, no gratuitous
colour, no confetti.

**The database is the truth; the UI is a view of it.** Screens never
invent state. A push notification is a pointer, a client callback is not a
payment confirmation, and a stale poll is shown as stale rather than
silently rendered as fact.

**Say what happened.** Every failure gets a specific sentence and a way
forward. "Something went wrong" with no retry is a bug, not a state — and
`ErrorState` requires `onRetry` at the type level so it cannot be built.

**Money is typographic.** Prices and totals use tabular figures so digits
do not jitter as a total updates. Amounts are always integers in paise
(D7); formatting happens at the edge.

**Two surfaces, one language.** Consumer surfaces (customer, runner) are
light, warm, paper-and-green. Operational surfaces (Store, Console) are
dark, dense and data-forward — an operator stares at them for a whole
shift, so the ground recedes and the data glows. Same tokens, same
component semantics, different `color` family.

---

## 2. Tokens

Import from `@craavee/tokens`. Never re-declare a value.

| Group | Names |
|---|---|
| `color.consumer` / `color.ops` | `bg surface surfaceAlt border borderStrong text textStrong textMuted textFaint brand brandStrong brandSoft onBrand accent accentSoft success warning danger info` (+ `*Soft`) `skeleton overlay` |
| `space` | `xs 4 · sm 8 · md 12 · base 16 · lg 20 · xl 24 · 2xl 32 · 3xl 40 · 4xl 56` — a 4pt grid |
| `radius` | `xs 6 · sm 10 · md 14 · lg 20 · xl 28 · full` |
| `font` | `display heading title subtitle body label caption` + `numeric` (tabular) |
| `elevation` | `none sm md lg` — four steps; a fifth would be used only because it exists |
| `motion` | `duration.{instant,fast,normal,slow}` · `easing.{enter,exit,move}` · `spring.{press,sheet}` |
| `touchTarget` | `min 44 · comfortable 48 · large 56` |

**Colour has two layers.** `palette` is raw pigment with no meaning;
`color.*` is semantic. Screens use the semantic layer only, so "what
colour is destructive" has one answer.

**Status colours are not the brand green.** Success and Craavee must stay
distinguishable, or a green button starts reading as a confirmation
message.

---

## 3. Components

**Web ops** — `@craavee/ui/ops`: `Table Th Td · Skeleton EmptyState
ErrorState ActionResult · Pill · Button · ConfirmDialog · fieldClass
useDebounced`

**Native** — `components/ui`: `Screen · Button · Skeleton SkeletonList
LoadingState EmptyState ErrorState StaleBanner · StatusPill`

Rules:

- **Every top-level native route uses `Screen`.** Never hard-code a top
  padding for the notch. `pt-14` and `pt-16` were wrong on any device
  whose inset differed from the one they were eyeballed against.
- **Every tappable thing clears 44pt.** `touchTarget.min` exists for this.
- **A control that can be busy shows it** — `loading` on `Button`, which
  reserves the spinner's width so the label never shifts mid-submit.
- Build a new primitive only when a second surface needs it. A component
  used once is a screen.

---

## 4. States

Every screen that fetches must be able to render:

`LOADING → EMPTY | SUCCESS | ERROR` and, where data can go behind,
`STALE / OFFLINE / RECONNECTING`.

- **Loading:** a skeleton shaped like the content, not a spinner, wherever
  the layout is known in advance.
- **Empty:** say why it is empty and what will fill it.
- **Error:** a specific sentence plus a retry. Always.
- **Stale:** `StaleBanner`. The customer app is poll-driven (D20) — a
  failed poll must never look like fresh data.

---

## 5. Motion

Four durations, three easings, two springs. That is the whole system.

Motion exists for **continuity, hierarchy, feedback and state change**.
Not for personality. A delivery app is used one-handed, standing up.

- Entering decelerates (`easing.enter`), leaving accelerates and is
  shorter (`easing.exit`).
- Press feedback is a 3% scale. Perceptible in the hand, invisible in a
  screenshot — which is the correct ratio.
- **Reduced motion is honoured globally**, not per component: the web
  media query is in `tokens.css`, native routes through `useMotion()`.
  Durations collapse to `instant` (1ms), never 0 — a zero-length
  animation can be dropped mid-flight, leaving a half-applied transform.
- Nothing animated may block input.

---

## 6. Haptics

Semantic, not physical: `selection success warning error impact`.

Only for a committed state change, a destructive confirmation, a
rejection the user must notice, or discrete selection. **Never** on
navigation, scrolling or an ordinary button — haptics on everything is
the same as haptics on nothing.

Always fire-and-forget. A simulator or a device with haptics off must
behave identically.

---

## 7. Accessibility

Not a pass at the end; part of the primitive.

- Every control: a role, a label, and `disabled`/`busy` state.
- Every touch target ≥ 44pt.
- Errors use `role="alert"`; stale banners are polite live regions.
- Decorative elements (skeletons) are hidden from screen readers.
- Contrast targets 4.5:1 for body text.
- Reduced motion, always.
- Web: visible focus rings. Never remove an outline without replacing it.

---

## 8. Responsive

Native uses flex, not breakpoints. Web uses `breakpoint.{sm,md,lg,xl}`
and caps content: `contentWidth.reading` for prose, `.app` for consumer
web, `.ops` for tables. Ops tables scroll inside their own container —
the page body never scrolls horizontally.

---

## 9. Feedback hierarchy

| Use | When |
|---|---|
| **Inline** | field-level validation; the error belongs to one input |
| **Banner** | a persistent condition — offline, stale, service paused |
| **ActionResult** | the outcome of a mutation the user just triggered |
| **Dialog** | a decision that needs confirming before it happens |
| **Full-screen error** | the screen has no content to show |

Anything touching **money, auth or security is explicit** — never a toast
that disappears.

---

## 10. Anti-patterns

- Hard-coding a hex, a radius or a spacing value. Import the token.
- A `Pressable` or `<button>` with a hand-written class string.
- An error state with no way forward.
- Rendering possibly-stale data as if it were fresh.
- A spinner where a skeleton would hold the layout.
- Animating because it is possible.
- Haptics on an ordinary tap.
- Removing a focus outline.
- Building a primitive for one screen.
