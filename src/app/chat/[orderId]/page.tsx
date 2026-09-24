"use client";

import { useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, Image as ImageIcon, Check, X, AlertTriangle,
  Clock, CreditCard, MessageSquare, Upload, Camera,
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import { useChat, useOrder, usePayments } from "@/lib/hooks";
import { updateOrder, createDispute, fetchOrderById, subscribeToOrder, apiAuthHeaders, type DBOrder } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

export default function ChatPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const { profile, supabaseUser, role: sessionRole } = useSession();
  const { messages, send } = useChat(orderId);
  const { order: hookOrder } = useOrder(orderId);
  const { payments, refetch: refetchPayments } = usePayments(orderId);

  const [retriedOrder, setRetriedOrder] = useState<DBOrder | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [text, setText] = useState("");
  const [role] = useState<"customer" | "merchant" | "rider" | "admin">(sessionRole === "business" ? "merchant" : (sessionRole as "customer" | "merchant" | "rider" | "admin") || "customer");
  const [uploading, setUploading] = useState(false);
  const [paymentProofSent, setPaymentProofSent] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [liveOrder, setLiveOrder] = useState<DBOrder | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const order = liveOrder || hookOrder || retriedOrder;
  const isMerchant = role === "merchant";
  const isAdmin = role === "admin";
  const canConfirmPayment = isMerchant || isAdmin;
  const isCustomer = role === "customer";

  useEffect(() => {
    if (order || retryCount >= 15) {
      if (retryCount >= 15 && !order) setNotFound(true);
      return;
    }
    const timer = setTimeout(() => {
      setRetryCount((r) => r + 1);
      import("@/lib/db").then(({ fetchOrderById }) => {
        fetchOrderById(orderId).then((o) => { if (o) setRetriedOrder(o); });
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [order, retryCount, orderId]);

  useEffect(() => {
    if (!orderId) return;
    return subscribeToOrder(orderId, (o) => setLiveOrder(o));
  }, [orderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Check if payment proof already sent
  useEffect(() => {
    if (order?.status === "payment_submitted" || order?.status === "payment_confirmed") {
      setPaymentProofSent(true);
    }
  }, [order?.status]);

  if (notFound) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center px-4 text-center animate-fade-in">
        <div>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-danger/10">
            <AlertTriangle className="h-8 w-8 text-danger" />
          </div>
          <h1 className="font-display text-xl font-bold">Order not found</h1>
          <p className="mt-2 max-w-sm text-sm text-muted">We couldn&apos;t find this order.</p>
          <div className="mt-6 flex flex-col gap-2 w-full max-w-xs">
            <Link href="/app" className="rounded-xl bg-go px-5 py-3 text-sm font-semibold text-white text-center hover:bg-go-2 transition">Browse merchants</Link>
            <Link href="/orders" className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium text-muted text-center hover:bg-elevated transition">View my orders</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-4 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
        <p className="mt-4 text-sm text-muted">Loading order…</p>
        {retryCount > 0 && <p className="mt-1 text-xs text-dim">Attempt {retryCount}/15</p>}
        <Link href="/app" className="mt-6 text-go text-sm font-medium hover:underline">← Back to merchants</Link>
      </div>
    );
  }

  const senderId = supabaseUser?.id || profile.email || "local-user";
  const senderName = profile.displayName || profile.name || (senderId === "local-user" ? "You" : "User");

  const sendMessage = () => {
    if (!text.trim()) return;
    setOpError(null);
    send({ order_id: orderId, sender_id: senderId, sender_name: senderName, sender_role: role, text: text.trim(), image_url: null, read: false })
      .catch((e) => setOpError(e instanceof Error ? e.message : "Message failed to send."));
    setText("");
    inputRef.current?.focus();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setOpError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", "chat-images");
      fd.append("path", `chat/${orderId}/${Date.now()}.${file.name.split(".").pop() || "jpg"}`);
      const res = await fetch("/api/upload", { method: "POST", headers: await apiAuthHeaders(false), body: fd });
      const json = await res.json();
      const url = json?.url;
      if (url) {
        // If this is a customer uploading and order is pending, mark as payment submitted
        if (isCustomer && order.status === "pending") {
          await updateOrder(orderId, { status: "payment_submitted" });
          send({ order_id: orderId, sender_id: senderId, sender_name: senderName, sender_role: "customer",
            text: `Payment proof uploaded · ${formatUgx(order.total_ugx)}`, image_url: url, read: false });
          setPaymentProofSent(true);
        } else {
          // Regular image message (for chat between any parties)
          send({ order_id: orderId, sender_id: senderId, sender_name: senderName, sender_role: role,
            text: text.trim() || "", image_url: url, read: false });
          setText("");
        }
      }
    } catch (err) {
      console.error("Image upload failed:", err);
      setOpError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmPayment = () => {
    void (async () => {
      await updateOrder(orderId, { status: "payment_confirmed", payment_confirmed: true });
      send({ order_id: orderId, sender_id: senderId, sender_name: senderName, sender_role: role,
        text: `Payment confirmed · ${formatUgx(order.total_ugx)} received`, image_url: null, read: false });
      refetchPayments();
    })();
  };

  const disputeOrder = () => {
    void (async () => {
      const paymentRef = payments[0]?.transaction_ref || `TXN${Date.now().toString(36).toUpperCase()}`;
      await createDispute({ order_id: orderId, payment_id: paymentRef, raised_by: senderId, raised_by_name: senderName,
        reason: "Payment disputed", status: "open", admin_note: "" });
      await updateOrder(orderId, { status: "disputed" });
      send({ order_id: orderId, sender_id: senderId, sender_name: senderName, sender_role: role,
        text: `Payment disputed · Admin notified`, image_url: null, read: false });
    })();
  };

  const isSubmitted = order.status === "payment_submitted";
  const isConfirmed = order.status === "payment_confirmed";

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 3.5rem)" }}>
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/orders" className="text-muted hover:text-fg transition"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{order.merchant_name || "Business"}</p>
            <p className="text-[10px] text-dim">Order #{orderId.slice(-6)} · {order.items}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
            order.status === "delivered" ? "bg-success/15 text-success" :
            order.status === "disputed" ? "bg-danger/15 text-danger" :
            order.status === "payment_submitted" ? "bg-warning/15 text-warning" :
            order.status === "payment_confirmed" ? "bg-success/15 text-success" :
            "bg-go/15 text-go"
          }`}>
            {order.status.replace(/_/g, " ")}
          </span>
        </div>

        {/* Order summary bar */}
        <div className="flex items-center justify-between border-t border-border bg-bg/50 px-4 py-2">
          <div>
            <p className="text-[10px] text-dim">Total</p>
            <p className="text-sm font-bold text-go">{formatUgx(order.total_ugx)}</p>
          </div>
          {order.customer_name && isMerchant && (
            <div className="text-right">
              <p className="text-[10px] text-dim">Customer</p>
              <p className="text-xs font-medium">{order.customer_name}</p>
            </div>
          )}
        </div>

        {/* Action buttons for merchant */}
        {isMerchant && isSubmitted && (
          <div className="flex gap-2 border-t border-border bg-bg/50 px-4 py-2.5">
            <button type="button" onClick={confirmPayment}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2.5 text-xs font-semibold text-white hover:bg-success/90 transition active:scale-[0.97]">
              <Check className="h-3.5 w-3.5" /> Confirm payment
            </button>
            <button type="button" onClick={disputeOrder}
              className="flex items-center justify-center gap-1 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-medium text-danger hover:bg-danger/20 transition">
              Dispute
            </button>
          </div>
        )}

        {/* Status banner for customer */}
        {isCustomer && (
          <div className="border-t border-border bg-bg/50 px-4 py-2.5">
            {order.status === "pending" && !paymentProofSent && (
              <div className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2">
                <Clock className="h-4 w-4 text-warning shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-warning">Payment pending</p>
                  <p className="text-[10px] text-muted">Upload your payment screenshot below to confirm your order</p>
                </div>
              </div>
            )}
            {isSubmitted && (
              <div className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2">
                <Clock className="h-4 w-4 text-warning shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-warning">Payment submitted</p>
                  <p className="text-[10px] text-muted">Waiting for the business to confirm your payment</p>
                </div>
              </div>
            )}
            {isConfirmed && (
              <div className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <p className="text-xs font-semibold text-success">Payment confirmed · Your order is being prepared</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {opError && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-danger">Not delivered</p>
              <p className="text-[10px] text-muted">{opError}</p>
            </div>
          </div>
        )}
        {messages.length === 0 && (
          <div className="py-12 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-go/10">
              <MessageSquare className="h-6 w-6 text-go" />
            </div>
            <p className="text-sm font-medium text-fg">{isMerchant ? "Chat with customer" : role === "rider" ? `Chat about ${order.merchant_name || "this order"}` : `Chat with ${order.merchant_name || "business"}`}</p>
            <p className="mt-1 text-xs text-muted">Send a message or upload payment proof</p>
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === senderId;
          return (
            <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"} animate-fade-in`}>
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${isMe ? "bg-go text-white" : "bg-surface text-fg border border-border"}`}>
                {!isMe && <p className="mb-0.5 text-[9px] font-semibold opacity-60">{msg.sender_name}</p>}
                {msg.image_url && (
                  <a href={msg.image_url} target="_blank" rel="noopener noreferrer" className="mb-1.5 block overflow-hidden rounded-xl">
                    <img src={msg.image_url} alt="Shared image" className="max-h-40 w-full rounded-xl object-cover" loading="lazy" />
                  </a>
                )}
                {msg.text && <p className="text-[13px] leading-snug">{msg.text}</p>}
                <p className={`mt-0.5 text-[8px] ${isMe ? "text-white/40" : "text-dim"}`}>{new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-surface px-3 py-2.5 safe-area-bottom">
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elevated text-muted hover:text-go transition"
            title="Upload payment screenshot or image">
            {uploading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-go border-t-transparent" /> : <Camera className="h-4 w-4" />}
          </button>
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={isCustomer && order.status === "pending" ? "Or type a message…" : "Type a message…"}
            className="flex-1 rounded-full bg-elevated px-4 py-2.5 text-sm outline-none placeholder:text-dim focus:bg-panel focus:ring-1 focus:ring-go/30" />
          <button type="button" onClick={sendMessage} disabled={!text.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-go text-white disabled:opacity-30 transition-all hover:scale-105 active:scale-95">
            <Send className="h-4 w-4" />
          </button>
        </div>
        {/* Payment proof prompt for customer when order is pending */}
        {isCustomer && order.status === "pending" && !paymentProofSent && (
          <div className="mt-2 rounded-xl bg-go/5 border border-go/20 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-go shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-go">Upload payment screenshot</p>
                <p className="text-[9px] text-muted">Pay {formatUgx(order.total_ugx)} to the business&apos;s MoMo number, then tap the camera icon to upload your payment screenshot</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
