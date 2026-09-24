"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Star, MapPin, Clock, Plus, Minus, ShoppingCart, BadgeCheck, Heart, Users, UtensilsCrossed, ShoppingCart as GroceryIcon, Pill, Shirt, Package, FileText, Store, ShoppingBag, MessageCircle, X } from "lucide-react";
import { fetchMerchantById, fetchProducts, type DBMerchant, type DBProduct } from "@/lib/db";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session-store";
import { MorseLogo } from "@/components/MorseLogo";

type Product = { id: string; name: string; desc: string; price: number; image?: string; images?: string[]; bulky?: boolean };

import { getCategoryIcon, getCategoryColor } from "@/lib/categories";




export default function MerchantPage() {
  const params = useParams();
  const id = String(params.id || "");
  const [merchant, setMerchant] = useState<DBMerchant | null>(null);
  const [loading, setLoading] = useState(true);
  const { add, lines, setQty, count, subtotal } = useCart();
  const { role, onboarded } = useSession();
  // Business/rider should not shop — redirect to their dashboard
  useEffect(() => {
    if (!onboarded) return;
    if (role === "business") window.location.href = "/business";
    else if (role === "rider") window.location.href = "/rider";
    else if (role === "admin") window.location.href = "/admin";
  }, [role, onboarded]);

  useEffect(() => {
    fetchMerchantById(id).then((m) => { setMerchant(m || null); setLoading(false); });
  }, [id]);

  const category = merchant?.category || "Food";
  const CatIcon = getCategoryIcon(category);
  const colors = getCategoryColor(category);

  // Load products from Supabase
  const [products, setProducts] = useState<Product[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const { supabaseUser } = useSession();
  useEffect(() => {
    if (merchant) {
      fetchProducts(merchant.id).then((dbProds) => {
        setProducts(
          dbProds
            .filter((p) => p.available)
            .map((p) => ({ id: p.id, name: p.name, desc: p.description, price: p.price, image: p.image_url || "", images: p.images || [], bulky: p.bulky === true }))
        );
      });
      // Load followers
      const customerId = supabaseUser?.id || "";
      fetch(`/api/followers?merchant_id=${merchant.id}&customer_id=${customerId}`)
        .then((r) => r.json())
        .then(({ count, isFollowing }) => {
          setFollowerCount(count || 0);
          setIsFollowing(isFollowing || false);
        })
        .catch(() => {});
    }
  }, [merchant]);

  const toggleFollow = async () => {
    if (!supabaseUser?.id || !merchant) return;
    const action = isFollowing ? "unfollow" : "follow";
    await fetch("/api/followers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: supabaseUser.id, merchant_id: merchant.id, action }),
    });
    setIsFollowing(!isFollowing);
    setFollowerCount((p) => isFollowing ? p - 1 : p + 1);
  };

  const isOpen = merchant ? (() => {
    const now = new Date();
    const hrs = now.getHours();
    const mins = now.getMinutes();
    const current = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    return current >= merchant.opens_at && current <= merchant.closes_at;
  })() : true;

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center px-4 text-center">
        <div>
          <p className="text-lg font-semibold">Merchant not found</p>
          <Link href="/app" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2 text-sm font-semibold text-white hover:bg-go-2 transition">
            <ArrowLeft className="h-4 w-4" /> Browse merchants
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-28">
      {/* Header */}
      <div className="border-b border-border bg-surface/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/app" className="text-muted hover:text-fg transition"><ArrowLeft className="h-5 w-5" /></Link>
          {(merchant as any).logo_url && (
            <img src={(merchant as any).logo_url} alt={merchant.name} className="h-10 w-10 rounded-xl object-cover ring-1 ring-border" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="font-display text-lg font-semibold truncate">{merchant.name}</h1>
              {merchant.verified && <BadgeCheck className="h-4 w-4 text-primary shrink-0" />}
            </div>
            <p className="text-[10px] text-muted">{merchant.tagline}</p>
          </div>
        </div>
      </div>

      {/* Merchant info */}
      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center gap-4 text-xs text-dim">
          <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" />{merchant.rating}</span>
          <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-go" />{(merchant as any).district || merchant.area || "Uganda"}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{merchant.opens_at}–{merchant.closes_at}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isOpen ? (
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">Open now</span>
          ) : (
            <span className="rounded-full bg-danger/15 px-2.5 py-0.5 text-[10px] font-semibold text-danger">Closed</span>
          )}
          <span className="text-[10px] text-dim">Delivery {merchant.delivery_fee_ugx === 0 ? "Free" : `UGX ${merchant.delivery_fee_ugx.toLocaleString()}`}</span>
          <span className="inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-dim"><Users className="h-3 w-3" />{followerCount} followers</span>
          <button type="button" onClick={toggleFollow}
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition ${isFollowing ? "bg-go/15 text-go" : "bg-surface border border-border text-muted hover:border-go/40"}`}>
            <Heart className={`h-3 w-3 ${isFollowing ? "fill-go" : ""}`} />
            {isFollowing ? "Following" : "Follow"}
          </button>
          <Link href="/chat"
            className="ml-auto flex items-center gap-1 rounded-full bg-go/10 px-2.5 py-0.5 text-[10px] font-semibold text-go hover:bg-go/20 transition">
            <MessageCircle className="h-3 w-3" /> Message
          </Link>
        </div>

        {/* Accepted payment methods + fixed Morse tag */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {((merchant.accepted_payments && merchant.accepted_payments.length ? [...merchant.accepted_payments].sort((a, b) => (a === "morse" ? -1 : b === "morse" ? 1 : 0)) : ["morse", "cash", "momo"]) as string[]).map((p) => {
            if (p === "cash") return <span key="cash" className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-muted">Cash on delivery</span>;
            if (p === "momo") return <span key="momo" className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-muted">Mobile Money</span>;
            if (p === "morse") return (merchant as any).morse_tag ? (
              <span key="morse" className="inline-flex items-center gap-1 rounded-full bg-go/15 px-2 py-0.5 text-[10px] font-semibold text-go">
                <MorseLogo markOnly className="h-2.5 w-2.5" />
                USD <span className="font-mono">@{(merchant as any).morse_tag.replace(/^@/, "")}</span>
              </span>
            ) : null;
            return null;
          })}
        </div>
      </div>

      {/* Products section */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2">
          <span className={`grid h-8 w-8 place-items-center rounded-lg ${colors.bg}`}>
            <CatIcon className={`h-4 w-4 ${colors.text}`} />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold">Menu</h2>
            <p className="text-[10px] text-muted">{products.length > 0 ? `${products.length} items` : "Products"}</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 space-y-2.5">
        {products.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-elevated">
              <Store className="h-6 w-6 text-dim" />
            </div>
            <p className="text-sm font-medium text-fg">No products listed yet</p>
            <p className="mt-1 text-xs text-muted">This merchant hasn&apos;t added products to their menu.</p>
          </div>
        ) : (
          products.map((p) => {
            const qty = lines.find((l) => l.productId === p.id)?.quantity || 0;
            return (
              <div key={p.id} className="flex items-start gap-3.5 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30">
                {p.image ? (
                  <button type="button" onClick={() => setViewerImage(p.image || null)}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-border hover:ring-2 hover:ring-go/50 transition active:scale-95">
                    <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${colors.bg}`}>
                    <CatIcon className={`h-5 w-5 ${colors.text}`} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{p.name}</p>
                  {p.bulky && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                      <Package className="h-3 w-3" /> Heavy item
                    </span>
                  )}
                  {p.desc && <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{p.desc}</p>}
                  <div className="mt-1.5"><Price amount={p.price} className="text-sm font-bold text-go" /></div>
                </div>
                <div className="shrink-0">
                  {qty === 0 ? (
                    <button type="button" onClick={() => add({ productId: p.id, merchantId: merchant.id, name: p.name, unitPriceUgx: p.price, bulky: p.bulky })}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-go text-white hover:bg-go-2 transition active:scale-90">
                      <Plus className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-go/30 bg-go/10 px-1.5 py-0.5">
                      <button type="button" onClick={() => setQty(p.id, qty - 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-surface text-go hover:bg-elevated transition"><Minus className="h-3 w-3" /></button>
                      <span className="min-w-[1.5rem] text-center text-sm font-bold text-go tabular-nums">{qty}</span>
                      <button type="button" onClick={() => setQty(p.id, qty + 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-go text-white hover:bg-go-2 transition"><Plus className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating cart bar — customer only */}
      {(role === "customer" || !onboarded) && count() > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-xl safe-area-bottom">
          <Link href="/cart" className="mx-auto flex max-w-lg items-center justify-between rounded-2xl bg-go px-5 py-3 text-white shadow-lg shadow-go/30 transition hover:bg-go-2 active:scale-[0.98]">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              <span className="text-sm font-semibold">{count()} {count() === 1 ? "item" : "items"}</span>
            </div>
            <Price amount={subtotal()} className="font-display text-sm font-bold" />
          </Link>
        </div>
      )}
      {/* Full-screen product image viewer */}
      {viewerImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4" onClick={() => setViewerImage(null)}>
          <button type="button" onClick={() => setViewerImage(null)}
            className="absolute top-4 right-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 transition">
            <X className="h-5 w-5" />
          </button>
          <img src={viewerImage} alt="Product" className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
