import { handleExpireStaleReservations } from "./handler.ts";

Deno.serve(handleExpireStaleReservations);
