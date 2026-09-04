// The operational surface kit: Store and Console.
//
// A separate entrypoint from "@craavee/ui" because these components are
// dark-surface, data-dense and client-only, while the root export still
// carries the marketing-era pieces. Importing from "@craavee/ui/ops"
// states which design language a file belongs to.
export {
  Table, Th, Td,
  Skeleton, EmptyState, ErrorState, ActionResult,
  Pill, ConfirmDialog, Button,
  fieldClass, btnClass, btnPrimaryClass,
  useDebounced,
} from "./primitives";
