// Deployed entry point. Local dev/tests run _dev/serve.ts instead
// (the CLI edge-runtime container fails to boot on this machine
// "failed to determine entrypoint" — a CLI/image issue, see
// PHASE_4_IMPLEMENTATION_REPORT.md §20). The handler is identical.
import { handleCreateOrder } from "./handler.ts";

Deno.serve(handleCreateOrder);
