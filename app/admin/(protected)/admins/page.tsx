"use client";

import { useEffect, useState } from "react";
import { BellOff, UserPlus } from "lucide-react";

interface AdminAccount {
  id: string;
  username: string;
  email: string;
  role: "owner" | "staff";
  status: "invited" | "active" | "disabled";
  twoFactorEnabled: boolean;
  /** Up to ORDER_NOTIFY_MAX admins are emailed when an order comes in. */
  notifyOnNewOrder: boolean;
  createdAt: string;
}

const STATUS_STYLES: Record<AdminAccount["status"], string> = {
  active: "bg-emerald-50 text-emerald-600",
  invited: "bg-amber-50 text-amber-600",
  disabled: "bg-zinc-100 text-zinc-500",
};

/**
 * Mirrors `ORDER_NOTIFY_MAX` in lib/models/admin.ts.
 *
 * Copied rather than imported: that module pulls in the MongoDB driver at
 * the top level, and a value import from a client component drags the
 * driver into the browser bundle. The server stays the authority — this
 * copy only decides when the table stops offering more switches, and a
 * PATCH past the cap is refused there whatever this number says.
 */
const ORDER_NOTIFY_MAX = 3;

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [inviting, setInviting] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/admins")
      .then((res) => {
        if (res.status === 403) {
          setForbidden(true);
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setAdmins(data);
        setLoading(false);
      });
  };

  useEffect(load, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");
      setInviteSuccess(`Invite sent to ${email}.`);
      setUsername("");
      setEmail("");
      setRole("staff");
      load();
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setInviting(false);
    }
  };

  const updateAdmin = async (
    id: string,
    body: { role?: string; status?: string },
  ) => {
    setActionError("");
    const res = await fetch(`/api/admin/admins/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error || "Failed to update admin");
      return;
    }
    load();
  };

  /**
   * Adds — or removes — one admin from the set emailed on every new order.
   *
   * Each switch stands on its own now, so only the row that was clicked
   * moves. Updated optimistically and without a reload afterwards: a
   * reload would blank the whole table behind a "Loading…" line for a
   * one-click toggle. On any failure the previous table is put back, which
   * matters more than it used to — the server can legitimately refuse a
   * claim (all slots taken, admin not active), and a switch left sitting
   * in the "on" position after a refusal would misreport who is being
   * emailed.
   */
  const setOrderNotifications = async (id: string, next: boolean) => {
    setActionError("");
    setInviteSuccess("");
    setNotifying(id);

    const previous = admins;
    setAdmins((current) =>
      current.map((a) => (a.id === id ? { ...a, notifyOnNewOrder: next } : a)),
    );

    try {
      const res = await fetch(`/api/admin/admins/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyOnNewOrder: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdmins(previous);
        setActionError(data.error || "Failed to update order notifications.");
      }
    } catch {
      setAdmins(previous);
      setActionError(
        "Something went wrong while updating order notifications.",
      );
    } finally {
      setNotifying(null);
    }
  };

  const resendInvite = async (id: string, email: string) => {
    setResending(id);
    setActionError("");
    setInviteSuccess("");
    try {
      const res = await fetch(`/api/admin/admins/${id}/resend-invite`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to resend invite");
      } else {
        setInviteSuccess(`Invite resent to ${email}.`);
      }
    } catch (err) {
      setActionError("Something went wrong while resending the invite.");
    } finally {
      setResending(null);
    }
  };

  if (forbidden) {
    return (
      <p className="text-zinc-500">
        Owner access is required to manage admins.
      </p>
    );
  }

  // At most ORDER_NOTIFY_MAX, by construction — the server refuses a claim
  // once the slots are full.
  const notifyRecipients = admins.filter((a) => a.notifyOnNewOrder);
  const slotsFull = notifyRecipients.length >= ORDER_NOTIFY_MAX;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-8">Admins</h1>

      <form
        onSubmit={handleInvite}
        className="bg-surface border border-border rounded-2xl p-6 mb-8"
      >
        <h2 className="font-medium text-zinc-900 mb-4 flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          Invite an admin
        </h2>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <input
            required
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="bg-white border border-border rounded-xl px-4 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-white border border-border rounded-xl px-4 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "owner" | "staff")}
            className="bg-white border border-border rounded-xl px-4 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        {inviteError && (
          <p className="text-red-500 text-sm mb-3">{inviteError}</p>
        )}
        {inviteSuccess && (
          <p className="text-emerald-600 text-sm mb-3">{inviteSuccess}</p>
        )}
        <button
          disabled={inviting}
          type="submit"
          className="bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
        >
          {inviting ? "Sending…" : "Send invite"}
        </button>
      </form>

      {actionError && (
        <p className="text-red-500 text-sm mb-4">{actionError}</p>
      )}

      {/* Nobody assigned is a real, silent failure mode: orders keep coming
          in and no one is told. Said plainly rather than left to be
          inferred from a row of empty switches. */}
      {!loading && admins.length > 0 && notifyRecipients.length === 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 mb-4 text-sm">
          <BellOff className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            No admin is receiving order notifications. Switch{" "}
            <span className="font-medium">Order emails</span> on for up to{" "}
            {ORDER_NOTIFY_MAX} active admins below and every new order will
            be sent to their addresses.
          </p>
        </div>
      )}

      {/* The addresses are listed rather than counted: "3 of 3 slots used"
          answers a question nobody has, and the thing an owner actually
          needs to check at a glance is whether their own address is on the
          list. The count is there for the second question — whether there
          is room to add someone. */}
      {!loading && notifyRecipients.length > 0 && (
        <p className="text-zinc-500 text-sm mb-4">
          New orders are emailed to{" "}
          {notifyRecipients.map((a, i) => (
            <span key={a.id}>
              {i > 0 && (i === notifyRecipients.length - 1 ? " and " : ", ")}
              <span className="font-medium text-zinc-900">{a.email}</span>
            </span>
          ))}
          .{" "}
          <span className="text-zinc-400">
            {slotsFull
              ? `All ${ORDER_NOTIFY_MAX} slots are in use — switch one off to add someone else.`
              : `${ORDER_NOTIFY_MAX - notifyRecipients.length} of ${ORDER_NOTIFY_MAX} slots free.`}
          </span>
        </p>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading admins…</p>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-zinc-500">
                <th className="px-5 py-3 font-medium">Username</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">2FA</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">
                  Order emails{" "}
                  <span className="font-normal text-zinc-400">
                    (max {ORDER_NOTIFY_MAX})
                  </span>
                </th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-zinc-900">{a.username}</td>
                  <td className="px-5 py-3 text-zinc-600">{a.email}</td>
                  <td className="px-5 py-3">
                    <select
                      value={a.role}
                      onChange={(e) =>
                        updateAdmin(a.id, { role: e.target.value })
                      }
                      className="bg-transparent text-zinc-900 text-sm focus:outline-none"
                    >
                      <option value="staff">Staff</option>
                      <option value="owner">Owner</option>
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[a.status]}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-600">
                    {a.twoFactorEnabled ? "Enabled" : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {/* Independent checkboxes, not a radio group: several
                        admins can be switched on at once, up to
                        ORDER_NOTIFY_MAX. Once the slots are full the
                        remaining switches go disabled rather than failing
                        on click — the server would refuse the PATCH
                        anyway, and a switch that visibly can't move
                        explains the cap better than an error message
                        after the fact. Rows already on stay clickable, so
                        there is always a way to free a slot. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.notifyOnNewOrder}
                      aria-label={`Email new orders to ${a.username}`}
                      disabled={
                        a.status !== "active" ||
                        notifying !== null ||
                        (!a.notifyOnNewOrder && slotsFull)
                      }
                      title={
                        a.status !== "active"
                          ? "Only an active admin can receive order notifications."
                          : a.notifyOnNewOrder
                            ? `Turn off — ${a.email} will stop being emailed about new orders.`
                            : slotsFull
                              ? `Order notifications are limited to ${ORDER_NOTIFY_MAX} admins. Switch one off first.`
                              : `Email every new order to ${a.email}`
                      }
                      onClick={() =>
                        setOrderNotifications(a.id, !a.notifyOnNewOrder)
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                        a.notifyOnNewOrder ? "bg-emerald-500" : "bg-zinc-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          a.notifyOnNewOrder
                            ? "translate-x-[18px]"
                            : "translate-x-[3px]"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex gap-4 justify-end items-center">
                      {a.status === "invited" && (
                        <button
                          onClick={() => resendInvite(a.id, a.email)}
                          disabled={resending === a.id}
                          className="text-amber-600 hover:text-amber-700 text-sm font-medium disabled:opacity-50"
                        >
                          {resending === a.id ? "Sending…" : "Resend"}
                        </button>
                      )}
                      {a.status === "disabled" ? (
                        <button
                          onClick={() => updateAdmin(a.id, { status: "active" })}
                          className="text-emerald-600 hover:text-emerald-700 text-sm font-medium"
                        >
                          Re-enable
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            updateAdmin(a.id, { status: "disabled" })
                          }
                          className="text-red-500 hover:text-red-600 text-sm font-medium"
                        >
                          Disable
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
