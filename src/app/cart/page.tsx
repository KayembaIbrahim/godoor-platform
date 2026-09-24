"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import {
  ArrowLeft, Minus, Plus, Trash2, LogIn, ShoppingBag,
  Store, PackagePlus, Truck, ChevronRight,
} from "lucide-react";
import { fetchMerchantById, fetchProducts, type DBMerchant, type DBProduct } from "@/lib/db";
import { formatUgx, calcServiceFee, calcDeliveryFee, BULKY_ITEM_SURCHARGE_UGX } from "@/lib/utils";
import { distanceKm } from "@/lib/location";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session-store";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";

export default function CartPage() {
  const lines = useCart((s) => s.lines);
  const merchantId = useCart((s) => s.merchantId);
  const merchantName = useCart((s) => s.merchantName);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const { onboarded, role } = useSession();
  const signup = useSignupPrompt();

  // Business/rider have no cart — redirect to their dashboard
  useEffect(() => {
    if (!onboarded) return;
    if (role === "business") window.location.href = "/business";
    else if (role === "rider") window.location.href = "/rider";
    else if (role === "admin") window.location.href = "/admin";
  }, [role, onboarded]);

  const [merchant, setMerchant] = useState<DBMerchant | null>(null);
  const [suggestions, setSuggestions] = useState<DBProduct[]>([]);
  const [estDistKm, setEstDistKm] = useState(3);

  useEffect(() => {
    if (!merchantId) { setMerchant(null); setSuggestions([]); return; }
    fetchMerchantById(merchantId).then((m) => setMerchant(m || null));
    fetchProducts(merchantId).then((products) => {
      const inCart = new Set(lines.map((l) => l.productId));
      const upsells = products.filter((p) => p.available && !inCart.has(p.id));
      setSuggestions(upsells.slice(0, 3));
    });
  }, [merchantId, lines.length]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + l.unitPriceUgx * l.quantity, 0);
    const bulkyCount = lines.reduce((s, l) => s + (l.bulky ? l.quantity : 0), 0);
    const delivery = calcDeliveryFee(estDistKm, bulkyCount);
    const service = calcServiceFee(subtotal);
    return { subtotal, delivery, bulkyCount, service, total: subtotal + delivery + service };
  }, [lines, estDistKm]);

  if (!lines.length) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-6 grid h-28 w-28 place-items-center rounded-full bg-elevated">
          <ShoppingBag className="h-14 w-14 text-dim" />
        </div>
        <h1 className="font-display text-2xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">
          Discover local businesses and add your favourites to get started.
        </p>
        <Link
          href="/app"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-go px-6 py-3 text-sm font-semibold text-white hover:bg-go-2"
        >
          <Store className="h-4 w-4" /> Browse merchants
        </Link>
        <Link
          href="/app"
          className="mt-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Keep shopping
        </Link>
      </div>
    );
  }

  const handleCheckout = () => {
    if (!onboarded) { signup.prompt("/checkout"); return; }
    window.location.href = "/checkout";
  };

  const addSuggestion = (p: DBProduct) => {
    useCart.getState().add({
      productId: p.id,
      merchantId: p.merchant_id,
      name: p.name,
      unitPriceUgx: p.price,
      quantity: 1,
      bulky: p.bulky === true,
    });
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-28 pt-4">
      {/* Header */}
      <Link href="/app" className="inline-flex items-center gap-1 text-sm text-muted">
        <ArrowLeft className="h-4 w-4" /> Continue shopping
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold">Cart</h1>
      {merchant && (
        <div className="mt-1.5 flex items-center gap-2 text-sm text-muted">
          <span className="font-medium text-fg">{merchant.name}</span>
          <span>·</span>
          <span>{merchant.area}</span>
          <Link
            href={`/app?merchant=${merchant.id}`}
            className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-go hover:text-go-2"
          >
            Browse store <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Guest signup prompt */}
      {!onboarded && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted">
          <LogIn className="h-3.5 w-3.5 shrink-0 text-go" />
          <span>
            Browsing as guest — your items are saved.{" "}
            <button
              type="button"
              onClick={() => signup.prompt("/checkout")}
              className="font-medium text-go underline"
            >
              Sign up at checkout
            </button>{" "}
            to pay from your wallet.
          </span>
        </div>
      )}

      {/* Cart items */}
      <ul className="mt-6 space-y-3">
        {lines.map((l) => (
          <li
            key={l.productId}
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4"
          >
            {/* Left: name + price */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{l.name}</p>
                {l.bulky && (
                  <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning">Heavy</span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {formatUgx(l.unitPriceUgx)} each
              </p>
              {l.quantity > 1 && (
                <p className="mt-0.5 text-xs text-dim">
                  Line total: {formatUgx(l.unitPriceUgx * l.quantity)}
                </p>
              )}
            </div>
            {/* Right: quantity controls + remove */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty(l.productId, l.quantity - 1)}
                className="grid h-9 w-9 place-items-center rounded-full border border-border bg-elevated transition hover:bg-panel"
                aria-label="Decrease quantity"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-7 text-center text-sm font-semibold tabular-nums">
                {l.quantity}
              </span>
              <button
                type="button"
                onClick={() => setQty(l.productId, l.quantity + 1)}
                className="grid h-9 w-9 place-items-center rounded-full border border-border bg-elevated transition hover:bg-panel"
                aria-label="Increase quantity"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setQty(l.productId, 0)}
                className="ml-1 grid h-7 w-7 place-items-center rounded-full text-dim transition hover:bg-danger/10 hover:text-danger"
                aria-label="Remove item"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Clear cart */}
      <button
        type="button"
        onClick={() => clear()}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger transition hover:bg-danger/10 active:scale-95"
      >
        <Trash2 className="h-3 w-3" /> Clear cart
      </button>

      {/* Delivery fee preview */}
      <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
        <Truck className="h-4 w-4 shrink-0 text-go" />
        <div className="flex-1">
          <p className="font-medium">Estimated delivery</p>
          <p className="text-xs text-muted">
            ~{estDistKm} km away · {formatUgx(calcDeliveryFee(estDistKm, totals.bulkyCount))}
            {estDistKm <= 2 && " (nearby)"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const input = prompt("Distance from merchant (km):", String(estDistKm));
            if (input) {
              const v = parseFloat(input);
              if (v > 0) setEstDistKm(v);
            }
          }}
          className="text-xs font-medium text-go hover:text-go-2"
        >
          Change
        </button>
      </div>

      {/* Order summary */}
      <div className="mt-4 space-y-2 rounded-2xl border border-border bg-surface p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">Subtotal ({lines.reduce((s, l) => s + l.quantity, 0)} items)</span>
          <Price amount={totals.subtotal} className="tabular-nums" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Delivery fee</span>
          <Price amount={totals.delivery - totals.bulkyCount * BULKY_ITEM_SURCHARGE_UGX} className="tabular-nums" />
        </div>
        {totals.bulkyCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted">Heavy item surcharge ({totals.bulkyCount} × {formatUgx(BULKY_ITEM_SURCHARGE_UGX)})</span>
            <Price amount={totals.bulkyCount * BULKY_ITEM_SURCHARGE_UGX} className="tabular-nums" />
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted">Service fee (5%)</span>
          <Price amount={totals.service} className="tabular-nums" />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Total</span>
          <Price amount={totals.total} className="tabular-nums text-go" />
        </div>
      </div>

      <p className="mt-3 text-xs text-dim">
        Pay the business directly via Mobile Money and confirm in chat. No wallet balance needed.
      </p>

      {/* Checkout CTA */}
      <button
        type="button"
        onClick={handleCheckout}
        className="mt-6 flex w-full items-center justify-center rounded-2xl bg-go py-3.5 text-sm font-semibold text-white transition hover:bg-go-2"
      >
        {onboarded
          ? `Checkout · ${formatUgx(totals.total)}`
          : `Continue to checkout · ${formatUgx(totals.total)}`}
      </button>

      {/* Upsell: add more from this merchant */}
      {suggestions.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-semibold">
            Add more from {merchant?.name ?? "this store"}
          </h2>
          <div className="mt-3 space-y-3">
            {suggestions.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <Price amount={p.price} className="text-sm text-muted" />
                </div>
                <button
                  type="button"
                  onClick={() => addSuggestion(p)}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-go/30 bg-go/10 px-3 py-1.5 text-xs font-semibold text-go transition hover:bg-go hover:text-white"
                >
                  <PackagePlus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Continue browsing */}
      {merchant && (
        <Link
          href={`/app?merchant=${merchant.id}`}
          className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface py-3 text-sm font-medium text-muted transition hover:bg-elevated hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> Continue browsing {merchant.name}
        </Link>
      )}

      <SignupModal
        open={signup.open}
        onClose={() => signup.setOpen(false)}
        returnTo={signup.returnTo}
      />
    </div>
  );
}
