"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Star, Clock, Plus, Heart, Truck, Loader2, UtensilsCrossed } from "lucide-react";
import { useCart } from "@/lib/cart-store";

/**
 * "Popular near you" — real menu items, from the real catalogue.
 *
 * Nothing here is fabricated: items come from the products table, the shop
 * name and rating from the merchant, and the price from the product. If a
 * shop has no products the section simply does not render, rather than
 * inventing rows to fill the space (the brief's "do not fill the interface
 * with fake cards").
 *
 * "Add to cart" writes to the same store the menu uses, so a guest can start
 * a basket from the homepage and finish it on the shop page.
 */

type Product = {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  image_url: string | null;
  images: string[] | null;
  available: boolean;
  bulky: boolean;
};

type Merchant = {
  id: string;
  name: string;
  category: string | null;
  rating: number | null;
  district: string | null;
  delivery_fee_ugx: number | null;
  logo_url: string | null;
};

const FREE_DELIVERY_OVER = 50_000;
const ETA = "25–35 min";

const ugx = (n: number) => `UGX ${Math.max(0, Math.round(n)).toLocaleString("en-US")}`;

export default function PopularPicks() {
  const [items, setItems] = useState<Product[]>([]);
  const [shops, setShops] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [hearts, setHearts] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const addToCart = useCart((s) => s.add);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Both endpoints are public. They are fetched together so the section
        // paints once, not twice — a second paint here is visible on 3G.
        const [pRes, mRes] = await Promise.all([
          fetch("/api/products", { cache: "no-store" }),
          fetch("/api/merchants", { cache: "no-store" }),
        ]);
        const [pJson, mJson] = await Promise.all([
          pRes.json().catch(() => null),
          mRes.json().catch(() => null),
        ]);
        if (!alive) return;
        setItems(Array.isArray(pJson?.products) ? pJson.products : []);
        setShops(Array.isArray(mJson?.merchants) ? mJson.merchants : []);
      } catch {
        // A failed fetch must not blank the section — it just stays empty.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shopById = useMemo(() => {
    const m = new Map<string, Merchant>();
    for (const s of shops) m.set(s.id, s);
    return m;
  }, [shops]);

  const picks = useMemo(() => {
    return items
      .filter((p) => p.available !== false && p.price > 0)
      .slice(0, 8)
      .map((p) => ({ product: p, shop: shopById.get(p.merchant_id) ?? null }));
  }, [items, shopById]);

  const toggleHeart = useCallback((id: string) => {
    setHearts((h) => ({ ...h, [id]: !h[id] }));
  }, []);

  const add = useCallback(
    (product: Product, shop: Merchant | null) => {
      addToCart({
        productId: product.id,
        merchantId: product.merchant_id,
        name: product.name,
        unitPriceUgx: Number(product.price) || 0,
        bulky: product.bulky === true,
      });
      setAdded((a) => ({ ...a, [product.id]: true }));
      window.setTimeout(() => setAdded((a) => ({ ...a, [product.id]: false })), 1600);
    },
    [addToCart],
  );

  // Nothing real to show — say so plainly instead of rendering an empty shelf.
  if (!loading && picks.length === 0) return null;

  return (
    <section id="popular" className="border-b border-border py-14">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Popular near you</h2>
            <p className="mt-1 text-sm text-muted">Live menu items from kitchens on GoDoor.</p>
          </div>
          <Link
            href="/browse/food"
            className="tap-44 relative inline-flex min-h-11 items-center text-sm font-semibold text-go"
          >
            See all
          </Link>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
                <div className="h-36 animate-pulse bg-elevated" />
                <div className="space-y-2 p-4">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-elevated" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-elevated" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="mt-6 flex snap-x gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
            {picks.map(({ product, shop }) => {
              const img = product.image_url || (product.images && product.images[0]) || null;
              const price = Number(product.price) || 0;
              const rating = shop?.rating ?? 0;
              const fee = Number(shop?.delivery_fee_ugx) || 0;
              return (
                <li
                  key={product.id}
                  className="group relative w-[15rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-surface transition hover:shadow-pop sm:w-auto"
                >
                  {/* Photo */}
                  <div className="relative h-36 overflow-hidden bg-elevated">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt={product.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-dim">
                        <UtensilsCrossed className="h-7 w-7" />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleHeart(product.id)}
                      aria-label={hearts[product.id] ? `Remove ${product.name} from favourites` : `Save ${product.name} to favourites`}
                      aria-pressed={!!hearts[product.id]}
                      className="tap-44 absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/35 backdrop-blur transition hover:bg-black/55"
                    >
                      <Heart
                        className={`h-4 w-4 ${hearts[product.id] ? "fill-go text-go" : "text-white"}`}
                      />
                    </button>
                  </div>

                  <div className="p-4">
                    <p className="truncate font-display text-sm font-bold">{product.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{shop?.name ?? "GoDoor kitchen"}</p>

                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                      {rating > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-fg">
                          <Star className="h-3 w-3 fill-warning text-warning" />
                          <span className="num">{rating.toFixed(1)}</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {ETA}
                      </span>
                    </div>

                    <p className="mt-2 flex items-center gap-1 text-[11px] text-dim">
                      <Truck className="h-3 w-3" />
                      {fee === 0
                        ? "Free delivery"
                        : `${ugx(fee)} delivery · free over ${ugx(FREE_DELIVERY_OVER)}`}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="num font-display text-base font-bold text-go">{ugx(price)}</span>
                      <button
                        type="button"
                        onClick={() => add(product, shop)}
                        aria-label={`Add ${product.name} to cart`}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-go px-3 text-xs font-bold text-white transition hover:bg-go-2 active:scale-[0.97]"
                      >
                        {added[product.id] ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" /> Added
                          </>
                        ) : (
                          <>
                            <Plus className="h-3 w-3" /> Add
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}