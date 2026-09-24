"use client";

import { useState, useEffect } from "react";
import { Users, Search, ShieldCheck, User, Mail, Calendar, Ban, Shield, Loader2 } from "lucide-react";
import { fetchUsers, type DBUser } from "@/lib/db";

const ROLE_COLORS: Record<string, string> = {
  customer: "bg-go/15 text-go",
  business: "bg-primary/15 text-primary",
  rider: "bg-[#f97316]/15 text-[#f97316]",
  admin: "bg-danger/15 text-danger",
};

export default function AdminUsers() {
  const [users, setUsers] = useState<DBUser[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.overview?.users) setUsers(d.overview.users); else fetchUsers().then(setUsers); setLoading(false); })
      .catch(() => { fetchUsers().then(setUsers); setLoading(false); });
  }, []);

  const filtered = users.filter((u) => {
    if (filter !== "all" && u.role !== filter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s);
  });

  const [acting, setActing] = useState<string | null>(null);

  const counts = {
    all: users.length,
    customer: users.filter((u) => u.role === "customer").length,
    business: users.filter((u) => u.role === "business").length,
    rider: users.filter((u) => u.role === "rider").length,
    admin: users.filter((u) => u.role === "admin").length,
  };

  const updateUserRole = async (userId: string, newRole: string) => {
    setActing(userId);
    try {
      await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, action: "update_role", role: newRole }) });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    } catch {}
    setActing(null);
  };

  const banUser = async (userId: string) => {
    if (!confirm("Ban this user? They will be unable to sign in.")) return;
    setActing(userId);
    try {
      await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, action: "ban" }) });
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch {}
    setActing(null);
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold">Users</h1>
        <span className="rounded-full bg-go/15 px-2.5 py-0.5 text-xs font-bold text-go">{users.length}</span>
      </div>
      <p className="mt-1 text-sm text-muted">All registered users on the GoDoor platform.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["all", "customer", "business", "rider", "admin"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === f ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go focus:ring-2" />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-dim">
              <tr>
                <th className="px-4 py-2.5 text-left">User</th>
                <th className="px-4 py-2.5 text-left">Email</th>
                <th className="px-4 py-2.5 text-center">Role</th>
                <th className="px-4 py-2.5 text-center hidden md:table-cell">Joined</th>
                <th className="px-4 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Loading users…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No users found</td></tr>
              ) : filtered.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-elevated/50 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-surface ring-1 ring-border">
                        <User className="h-4 w-4 text-muted" />
                      </div>
                      <span className="text-xs font-medium">{u.name || "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${ROLE_COLORS[u.role] || "bg-elevated text-muted"}`}>
                      {u.role === "admin" && <ShieldCheck className="h-2.5 w-2.5" />}
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-[10px] text-dim hidden md:table-cell">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <select value={u.role} disabled={acting === u.id}
                        onChange={(e) => updateUserRole(u.id, e.target.value)}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-[10px] outline-none">
                        {["customer","business","rider","admin"].map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {acting === u.id ? <Loader2 className="h-3 w-3 animate-spin text-muted" />
                        : u.role !== "admin" && <button type="button" onClick={() => banUser(u.id)} title="Ban user" className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"><Ban className="h-3.5 w-3.5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
