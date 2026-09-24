"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ShieldCheck, BadgeCheck, Clock, AlertTriangle, Store, Truck,
  CheckCircle2, Camera, FileText, Loader2, Save
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import { DocumentUpload } from "@/components/DocumentUpload";
import { getUserVerificationStatus, fetchVerificationDocs, updateRider, fetchRiders, type VerificationDoc } from "@/lib/db";

export default function VerificationPage() {
  const { role, supabaseUser, profile } = useSession();
  const [status, setStatus] = useState<"none" | "pending" | "approved" | "rejected">("none");
  const [docs, setDocs] = useState<VerificationDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const isRider = role === "rider";
  const userId = supabaseUser?.id || "";

  // Vehicle plate — riders only
  const [plate, setPlate] = useState("");
  const [plateSaved, setPlateSaved] = useState(false);
  const [plateSaving, setPlateSaving] = useState(false);

  useEffect(() => {
    if (!isRider || !userId) return;
    fetchRiders().then((riders) => {
      const r = riders.find((x) => x.id === userId);
      if (r?.plate) { setPlate(r.plate); setPlateSaved(true); }
    }).catch(() => {});
  }, [isRider, userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    getUserVerificationStatus(userId).then(setStatus);
    fetchVerificationDocs(userId, isRider ? "rider" : "business").then((d) => {
      setDocs(d);
      setLoading(false);
    });
  }, [userId, isRider]);

  const docSets = isRider
    ? [
        { type: "vehicle_photo", label: "Vehicle photo", desc: "A clear photo of your bike/car from the side", required: true },
        { type: "national_id", label: "National ID", desc: "Government-issued national ID (front)", required: true },
      ]
    : [
        { type: "shop_photo", label: "Shop location photo", desc: "A clear photo of your shop/storefront", required: true },
        { type: "trade_licence", label: "Trade Licence", desc: "Town/City council trade licence", required: true },
        { type: "national_id", label: "National ID", desc: "Government-issued national ID", required: true },
      ];

  const STATUS_UI = {
    none: { icon: ShieldCheck, text: "Not submitted", cls: "bg-elevated text-muted" },
    pending: { icon: Clock, text: "Under review", cls: "bg-warning/15 text-warning" },
    approved: { icon: BadgeCheck, text: "Verified", cls: "bg-success/15 text-success" },
    rejected: { icon: AlertTriangle, text: "Rejected — re-upload", cls: "bg-danger/15 text-danger" },
  } as const;
  const S = STATUS_UI[status];
  const StatusIcon = S.icon;

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-24">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/account" className="text-muted hover:text-fg"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="font-display text-lg font-semibold">Verification</h1>
        {!loading && (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${S.cls}`}>
            <StatusIcon className="h-3 w-3" /> {S.text}
          </span>
        )}
      </div>

      <div className="px-4 pt-5 space-y-4">
        {/* Explainer */}
        <div className="rounded-2xl border border-go/25 bg-go/8 p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/15">
              {isRider ? <Truck className="h-5 w-5 text-go" /> : <Store className="h-5 w-5 text-go" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">Get your {isRider ? "rider" : "business"} badge</p>
              <p className="mt-0.5 text-xs text-muted">
                {isRider
                  ? "Verified riders can accept orders. Unverified riders can view nearby orders only."
                  : "Verified businesses get a trust badge customers can see before they order."}
              </p>
            </div>
          </div>
          {isRider && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-[11px] text-muted">You can see deliveries near you, but must be verified to accept them.</p>
            </div>
          )}
        </div>

        {!userId ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="text-sm text-muted">Sign in to upload verification documents.</p>
            <Link href="/account" className="mt-3 inline-flex rounded-xl bg-go px-4 py-2 text-xs font-semibold text-white">Go to profile</Link>
          </div>
        ) : (
          <>
            {isRider && (
              <div className="rounded-2xl border border-border bg-surface p-4">
                <label className="text-xs font-medium text-muted">Vehicle number plate</label>
                <p className="mt-0.5 text-[11px] text-dim mt-1">Your plate is matched to your vehicle photo during review.</p>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    value={plate}
                    onChange={(e) => { setPlate(e.target.value.toUpperCase()); setPlateSaved(false); }}
                    placeholder="e.g. UAN 123M"
                    autoCapitalize="characters"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2.5 text-sm uppercase tracking-wide outline-none ring-go focus:ring-2"
                  />
                  <button type="button" disabled={plateSaving || !plate.trim() || plateSaved}
                    onClick={async () => {
                      setPlateSaving(true);
                      await updateRider({ id: userId, plate: plate.trim().toUpperCase() });
                      setPlateSaving(false);
                      setPlateSaved(true);
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
                    {plateSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : plateSaved ? <CheckCircle2 className="h-3.5 w-3.5 text-white" /> : <Save className="h-3.5 w-3.5" />}
                    {plateSaved ? "Saved" : "Save plate"}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-border bg-surface p-4">
              <DocumentUpload
                role={isRider ? "rider" : "business"}
                userId={userId}
                docs={docSets}
                onComplete={() => {
                  setStatus("pending");
                  setLoading(true);
                  fetchVerificationDocs(userId, isRider ? "rider" : "business").then((d) => { setDocs(d); setLoading(false); });
                }}
              />
            </div>
          </>
        )}

        {/* Submitted docs */}
        {docs.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim">Submitted documents</h3>
            <div className="space-y-2">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-go" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium capitalize truncate">{d.document_type.replace("_", " ")}</p>
                    <p className="text-[10px] text-dim">{new Date(d.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                    d.status === "approved" ? "bg-success/15 text-success" :
                    d.status === "rejected" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"
                  }`}>
                    {d.status === "approved" ? <CheckCircle2 className="h-2.5 w-2.5" /> :
                     d.status === "rejected" ? <AlertTriangle className="h-2.5 w-2.5" /> :
                     <Clock className="h-2.5 w-2.5" />}
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[10px] text-dim">Documents are reviewed by the GoDoor admin team. You can re-upload if a document is rejected.</p>
      </div>
    </div>
  );
}
