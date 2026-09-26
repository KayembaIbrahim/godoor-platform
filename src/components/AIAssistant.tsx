"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X, Send, User, Loader2, ChevronDown } from "lucide-react";

type ChatMsg = { role: "user" | "assistant"; content: string };

const QUICK_PROMPTS = [
  "How do I order on GoDoor?",
  "How do I register my business?",
  "How does rider verification work?",
  "What payment methods are accepted?",
  "How do I track my delivery?",
];

function AIModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "Hi! I'm GoDoor AI — your delivery assistant. Ask me anything about using GoDoor!" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) {
      setInput("");
      setLoading(false);
    }
  }, [open]);

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    const userMsg: ChatMsg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const { reply } = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I'm having trouble connecting. Try again." }]);
    }
    setLoading(false);
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative z-10 flex flex-col w-full max-w-md mx-auto sm:mx-4 h-[85dvh] sm:h-[500px] rounded-t-3xl sm:rounded-3xl bg-bg border border-border shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-go to-primary">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <rect x="3" y="2" width="13" height="20" rx="2" fill="white" />
                <path d="M16 2L21 4V20L16 22V2Z" fill="rgba(255,255,255,0.7)" />
                <circle cx="14" cy="12.5" r="1.2" fill="var(--primary)" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold">GoDoor AI</h2>
              <p className="text-[10px] text-success flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Online
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:text-fg transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`flex items-start gap-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                  msg.role === "user" ? "bg-go/15" : "bg-gradient-to-br from-go to-primary"
                }`}>
                  {msg.role === "user" ? (
                    <User className="h-3.5 w-3.5 text-go" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <rect x="3" y="2" width="13" height="20" rx="2" fill="white" />
                      <path d="M16 2L21 4V20L16 22V2Z" fill="rgba(255,255,255,0.7)" />
                      <circle cx="14" cy="12.5" r="1.2" fill="var(--primary)" />
                    </svg>
                  )}
                </div>
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-go text-white rounded-br-md"
                    : "bg-surface border border-border text-fg rounded-bl-md"
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-start gap-2">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-go to-primary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="3" y="2" width="13" height="20" rx="2" fill="white" />
                    <path d="M16 2L21 4V20L16 22V2Z" fill="rgba(255,255,255,0.7)" />
                    <circle cx="14" cy="12.5" r="1.2" fill="var(--primary)" />
                  </svg>
                </div>
                <div className="rounded-2xl rounded-bl-md bg-surface border border-border px-4 py-3">
                  <Loader2 className="h-4 w-4 text-go animate-spin" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Quick prompts */}
        {messages.length <= 1 && (
          <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
            {QUICK_PROMPTS.map((p) => (
              <button key={p} type="button" onClick={() => send(p)}
                className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] text-muted hover:border-go/40 hover:text-go transition">
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border px-3 py-3 shrink-0">
          <div className="flex items-center gap-2 rounded-2xl bg-surface border border-border px-3 py-1.5 focus-within:ring-2 focus-within:ring-go/40">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Ask GoDoor AI..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-dim"
              disabled={loading}
            />
            <button type="button" onClick={() => send()}
              disabled={!input.trim() || loading}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-go text-white hover:bg-go-2 disabled:opacity-40 transition">
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Floating trigger button
export function AITrigger() {
  const [open, setOpen] = useState(false);
  const [canRender, setCanRender] = useState(false);
  useEffect(() => { setCanRender(true); }, []);

  if (!canRender) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-go to-primary text-white shadow-lg shadow-go/30 hover:scale-105 active:scale-95 transition"
        aria-label="AI Assistant">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect x="3" y="2" width="13" height="20" rx="2" fill="white" />
          <path d="M16 2L21 4V20L16 22V2Z" fill="rgba(255,255,255,0.7)" />
          <circle cx="14" cy="12.5" r="1.2" fill="var(--primary)" />
        </svg>
      </button>
      <AIModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
