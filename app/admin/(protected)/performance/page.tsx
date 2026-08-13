import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/adminGuard";
import PerformanceView from "./PerformanceView";

/**
 * Owner-only, guarded here as well as in the API the client calls.
 *
 * Same reasoning as /admin/audit: without the server-side check, a staff
 * account navigating straight to this URL would render the whole shell and
 * only then watch its fetch fail, which reads as a broken page rather than
 * a page they aren't meant to see.
 */
export default async function PerformancePage() {
  const owner = await requireOwner();
  if (!owner) redirect("/admin");

  return <PerformanceView />;
}
