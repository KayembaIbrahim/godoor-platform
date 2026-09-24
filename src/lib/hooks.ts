"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchMerchants,
  fetchOrders,
  fetchOrderById,
  fetchPayments,
  fetchChat,
  sendChatMessage,
  subscribeToChat,
  subscribeToOrderStatus,
  type DBMerchant,
  type DBOrder,
  type DBPayment,
  type DBChatMessage,
} from "./db";

/** Hook: fetch merchants list */
export function useMerchants() {
  const [merchants, setMerchants] = useState<DBMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const doFetch = useCallback(() => {
    fetchMerchants().then((m) => { setMerchants(m); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { doFetch(); }, [doFetch]);
  // Re-fetch when returning to the page so stale data never sticks
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") doFetch(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [doFetch]);
  return { merchants, loading, refetch: doFetch };
}

/** Hook: fetch orders with filters */
export function useOrders(filters?: { merchant_id?: string; customer_id?: string; status?: string }) {
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const doFetch = useCallback(() => {
    fetchOrders(filters).then((o) => { setOrders(o); setLoading(false); }).catch(() => setLoading(false));
  }, [filters?.merchant_id, filters?.customer_id, filters?.status]); // eslint-disable-line
  useEffect(() => { doFetch(); }, [doFetch]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") doFetch(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [doFetch]);
  return { orders, loading, refetch: doFetch };
}

/** Hook: fetch single order */
export function useOrder(orderId: string | null) {
  const [order, setOrder] = useState<DBOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const doFetch = useCallback(() => {
    if (!orderId) { setLoading(false); return; }
    fetchOrderById(orderId).then((o) => { setOrder(o || null); setLoading(false); }).catch(() => setLoading(false));
  }, [orderId]);
  useEffect(() => { doFetch(); }, [doFetch]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") doFetch(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [doFetch]);
  return { order, loading };
}

/** Hook: fetch payments for an order */
export function usePayments(orderId: string | null) {
  const [payments, setPayments] = useState<DBPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const doFetch = useCallback(() => {
    if (!orderId) { setLoading(false); return Promise.resolve(); }
    return fetchPayments(orderId).then((p) => { setPayments(p); setLoading(false); }).catch(() => setLoading(false));
  }, [orderId]);
  useEffect(() => { doFetch(); }, [doFetch]);
  useEffect(() => {
    if (!orderId) return;
    const onVis = () => { if (document.visibilityState === "visible") doFetch(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [doFetch, orderId]);
  return { payments, loading, refetch: doFetch };
}

/** Hook: real-time chat for an order */
export function useChat(orderId: string | null) {
  const [messages, setMessages] = useState<DBChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    fetchChat(orderId).then((msgs) => { setMessages(msgs); setLoading(false); });

    const unsub = subscribeToChat(orderId, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return unsub;
  }, [orderId]);

  const send = useCallback(async (msg: Omit<DBChatMessage, "id" | "created_at">) => {
    const saved = await sendChatMessage(msg);
    setMessages((prev) => {
      if (prev.some((m) => m.id === saved.id)) return prev;
      return [...prev, saved];
    });
    return saved;
  }, []);

  return { messages, loading, send };
}

/** Hook: subscribe to order status changes */
export function useOrderStatus(orderId: string | null, initialStatus: string) {
  const [status, setStatus] = useState(initialStatus);
  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]); // eslint-disable-line
  useEffect(() => {
    if (!orderId) return;
    return subscribeToOrderStatus(orderId, setStatus);
  }, [orderId]);
  return status;
}
