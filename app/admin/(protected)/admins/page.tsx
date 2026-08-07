"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";

interface AdminAccount {
  id: string;
  username: string;
  email: string;
  role: "owner" | "staff";
  status: "invited" | "active" | "disabled";
  twoFactorEnabled: boolean;
  createdAt: string;
}

const STATUS_STYLES: Record<AdminAccount["status"], string> = {
  active: "bg-emerald-50 text-emerald-600",
  invited: "bg-amber-50 text-amber-600",
  disabled: "bg-zinc-100 text-zinc-500",
};

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [inviting, setInviting] = useState(false);
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

  if (forbidden) {
    return (
      <p className="text-zinc-500">
        Owner access is required to manage admins.
      </p>
    );
  }

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
                  <td className="px-5 py-3 text-right">
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
