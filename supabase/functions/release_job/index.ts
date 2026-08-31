// Deployed entry point. Local dev/tests run _dev/serve.ts instead
// (PHASE_4_IMPLEMENTATION_REPORT.md §20). The handler is identical.
import { handleReleaseJob } from "./handler.ts";

Deno.serve(handleReleaseJob);
