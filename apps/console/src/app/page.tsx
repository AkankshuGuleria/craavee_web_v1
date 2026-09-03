import { redirect } from "next/navigation";

// The Console has a real landing surface now (Phase 9A), so `/` is a
// redirect rather than a second, emptier version of it.
export default function ConsoleHomePage() {
  redirect("/overview");
}
