"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Camera, Loader2, Trash2 } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { apiAuthHeaders } from "@/lib/db";

export type Story = {
  id: string;
  merchant_id: string;
  media_url: string;
  media_type: "image" | "video";
  caption: string;
  expires_at: string;
  created_at: string;
  merchant_name?: string;
};

function ProgressRing({ duration, active }: { duration: number; active: boolean }) {
  const circumference = 2 * Math.PI * 10;
  const [offset, setOffset] = useState(circumference);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) { setOffset(circumference); return; }
    startRef.current = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      setOffset(circumference * (1 - progress));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, duration]);

  return (
    <svg width="24" height="24" className="shrink-0">
      <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#fff" strokeWidth="2"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 12 12)" />
    </svg>
  );
}

export function StoriesStrip({ stories, onOpen }: { stories: Story[]; onOpen: (idx: number) => void }) {
  if (stories.length === 0) return null;

  const grouped = stories.reduce<Record<string, Story[]>>((acc, s) => {
    (acc[s.merchant_id] = acc[s.merchant_id] || []).push(s);
    return acc;
  }, {});

  return (
    <div className="px-4 pt-4">
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {Object.entries(grouped).map(([merchantId, merchantStories]) => (
          <button key={merchantId} type="button" onClick={() => {
            const idx = stories.findIndex((s) => s.merchant_id === merchantId);
            onOpen(idx >= 0 ? idx : 0);
          }}
            className="flex shrink-0 flex-col items-center gap-1.5">
            <div className="relative">
              <div className="h-14 w-14 rounded-full bg-gradient-to-br from-go to-primary p-[2px]">
                <div className="flex h-full w-full items-center justify-center rounded-full bg-bg overflow-hidden">
                  {merchantStories[0].media_url ? (
                    <img src={merchantStories[0].media_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-5 w-5 text-dim" />
                  )}
                </div>
              </div>
              {merchantStories.length > 1 && (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-go text-[8px] font-bold text-white">
                  {merchantStories.length}
                </span>
              )}
            </div>
            <span className="text-[9px] text-muted truncate max-w-[56px]">
              {merchantStories[0].merchant_name?.split(" ")[0] || "Shop"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Full-screen story viewer — navigates across ALL merchants
export function StoryViewer({ stories, initialIndex, onClose }: {
  stories: Story[];
  initialIndex: number;
  onClose: () => void;
}) {
  // Build a flat list of unique merchant IDs in order of appearance
  const merchantOrder = useCallback(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const s of stories) {
      if (!seen.has(s.merchant_id)) {
        seen.add(s.merchant_id);
        order.push(s.merchant_id);
      }
    }
    return order;
  }, [stories])();

  // Find which merchant the initial index belongs to
  const initialMerchantId = stories[initialIndex]?.merchant_id || merchantOrder[0];
  const [merchantIdx, setMerchantIdx] = useState(() => merchantOrder.indexOf(initialMerchantId));
  const [storyIdx, setStoryIdx] = useState(0);
  const { supabaseUser, role } = useSession();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentMerchantId = merchantOrder[merchantIdx] || merchantOrder[0];
  const currentMerchantStories = stories.filter((s) => s.merchant_id === currentMerchantId);
  const story = currentMerchantStories[storyIdx];
  const isOwner = role === "business";

  const goNext = useCallback(() => {
    if (storyIdx < currentMerchantStories.length - 1) {
      // Next story of same merchant
      setStoryIdx((p) => p + 1);
    } else if (merchantIdx < merchantOrder.length - 1) {
      // Move to next merchant
      setMerchantIdx((p) => p + 1);
      setStoryIdx(0);
    } else {
      // All done
      onClose();
    }
  }, [storyIdx, currentMerchantStories.length, merchantIdx, merchantOrder.length, onClose]);

  const goPrev = useCallback(() => {
    if (storyIdx > 0) {
      setStoryIdx((p) => p - 1);
    } else if (merchantIdx > 0) {
      // Go to last story of previous merchant
      setMerchantIdx((p) => p - 1);
      const prevMerchantId = merchantOrder[merchantIdx - 1];
      const prevCount = stories.filter((s) => s.merchant_id === prevMerchantId).length;
      setStoryIdx(prevCount - 1);
    }
  }, [storyIdx, merchantIdx, merchantOrder, stories]);

  useEffect(() => {
    timerRef.current = setTimeout(goNext, story?.media_type === "video" ? 10000 : 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [storyIdx, merchantIdx, goNext, story?.media_type]);

  const handleDelete = async () => {
    if (!story) return;
    await fetch(`/api/stories?id=${story.id}`, { method: "DELETE" });
    onClose();
  };

  if (!story) return null;

  // Build progress indicators across all merchants
  const allProgressBars: { key: string; done: boolean; active: boolean }[] = [];
  for (let mi = 0; mi < merchantOrder.length; mi++) {
    const mStories = stories.filter((s) => s.merchant_id === merchantOrder[mi]);
    for (let si = 0; si < mStories.length; si++) {
      const done = mi < merchantIdx || (mi === merchantIdx && si < storyIdx);
      const active = mi === merchantIdx && si === storyIdx;
      allProgressBars.push({ key: mStories[si].id, done, active });
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center" onClick={onClose}>
      {/* Progress bars — all merchants */}
      <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 px-3 pt-3">
        {allProgressBars.map((bar) => (
          <div key={bar.key} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
            <div className={`h-full bg-white transition-all ${bar.done ? "w-full" : bar.active ? "animate-[progress_5s_linear]" : "w-0"}`} />
          </div>
        ))}
      </div>

      {/* Merchant name + close */}
      <div className="absolute top-4 left-0 right-0 z-10 flex items-center justify-between px-4 pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">{story.merchant_name || "Business"}</span>
          <span className="text-[10px] text-white/60">
            {new Date(story.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {merchantOrder.length > 1 && (
            <span className="text-[10px] text-white/40">
              {merchantIdx + 1}/{merchantOrder.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 transition">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 transition">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Media */}
      <div className="relative w-full h-full flex items-center justify-center" onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width / 3) goPrev();
        else goNext();
      }}>
        {/* Previous arrow (visible on larger screens) */}
        {(storyIdx > 0 || merchantIdx > 0) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-2 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition hidden sm:grid">
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {story.media_type === "video" && story.media_url ? (
          <video src={story.media_url} autoPlay muted loop playsInline className="max-h-full max-w-full object-contain" />
        ) : story.media_url ? (
          <img src={story.media_url} alt={story.caption || ""} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-go/20 to-primary/20">
            <Camera className="h-16 w-16 text-white/30" />
          </div>
        )}

        {/* Next arrow (visible on larger screens) */}
        <button type="button" onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-2 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition hidden sm:grid">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Caption */}
      {story.caption && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-4 pb-8 pt-16">
          <p className="text-sm text-white">{story.caption}</p>
        </div>
      )}
    </div>
  );
}

// Story composer for businesses
export function StoryComposer({ merchantId, onDone }: { merchantId: string; onDone?: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [showInput, setShowInput] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePost = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !merchantId) return;
    setUploading(true);
    try {
      // Upload media
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", "stories");
      const uploadRes = await fetch("/api/upload", { method: "POST", headers: await apiAuthHeaders(false), body: fd });
      const { url } = await uploadRes.json().catch(() => ({}));
      if (!url) throw new Error("Upload failed");

      // Create story
      await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchantId,
          media_url: url,
          media_type: file.type.startsWith("video/") ? "video" : "image",
          caption,
        }),
      });
      setCaption("");
      setShowInput(false);
      onDone?.();
    } catch (err) {
      console.error("Story post failed:", err);
    }
    setUploading(false);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handlePost} />
      {showInput ? (
        <div className="flex items-center gap-2">
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add caption..."
            className="w-32 rounded-lg border border-border bg-bg px-2 py-1.5 text-xs outline-none ring-go focus:ring-2" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="shrink-0 rounded-lg bg-go px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-go-2 transition disabled:opacity-50">
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Post"}
          </button>
          <button type="button" onClick={() => { setShowInput(false); setCaption(""); }}
            className="text-[10px] text-dim hover:text-fg">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowInput(true)}
          className="rounded-xl bg-go/15 px-3 py-2 text-xs font-semibold text-go hover:bg-go/25 transition">
          + Post status
        </button>
      )}
    </>
  );
}
