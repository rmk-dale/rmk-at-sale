import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/adminGuard";
import AuditLogView from "./AuditLogView";

/**
 * Owner-only. Guarded on the server as well as by the API the client
 * calls, so navigating straight to /admin/audit as staff redirects rather
 * than rendering a shell that then fails its fetch.
 */
export default async function AuditPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/admin");

  return <AuditLogView />;
}
