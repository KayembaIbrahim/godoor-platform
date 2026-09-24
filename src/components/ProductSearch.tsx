"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ArrowRight, Store } from "lucide-react";
import { formatUgx } from "@/lib/utils";
import type { DBMerchant, DBProduct } from "@/lib/db";

export function ProductSearch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [merchants, setMerchants] = useState<DBMerchant[]>([]);
  const [products, setProducts] = useState<DBProduct[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    if (!loaded) {
      Promise.all([
        fetch("/api/products").then((r) => r.json()),
        fetch("/api/merchants").then((r) => r.json()),
      ]).then(([p, m]) => {
        setProducts(p);
        setMerchants(m);
        setLoaded(true);
      });
    }
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const merchantMap = useMemo(() => {
    const map = new Map<string, DBMerchant>();
    for (const m of merchants) map.set(m.id, m);
    return map;
  }, [merchants]);

  const results = useMemo(() => {
    if (!debounced) return [];
    const matched = products.filter(
      (p) =>
        p.name.toLowerCase().includes(debounced) ||
        p.description.toLowerCase().includes(debounced) ||
        p.category.toLowerCase().includes(debounced)
    );
    const grouped = new Map<
      string,
      { merchant: DBMerchant; products: DBProduct[] }
    >();
    for (const p of matched) {
      const m = merchantMap.get(p.merchant_id);
      if (!m) continue;
      if (!grouped.has(m.id)) grouped.set(m.id, { merchant: m, products: [] });
      grouped.get(m.id)!.products.push(p);
    }
    return Array.from(grouped.values());
  }, [debounced, products, merchantMap]);

  const goToMerchant = useCallback(
    (merchantId: string, productId: string) => {
      router.push(`/app/merchant/${merchantId}?focusProduct=${productId}`);
      onClose();
    },
    [router, onClose]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Search size={20} className="text-muted" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search food, drinks, anything..."
          className="flex-1 bg-transparent text-sm text-fg placeholder:text-muted outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="rounded-full p-1 text-muted hover:bg-muted/10"
          >
            <X size={16} />
          </button>
        )}
        <button
          onClick={onClose}
          className="ml-1 rounded-xl bg-muted/10 px-3 py-1.5 text-xs font-medium text-muted hover:bg-muted/20"
        >
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!loaded && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {loaded && debounced && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 rounded-2xl bg-muted/10 p-6">
              <Search size={40} className="text-muted" />
            </div>
            <p className="text-sm font-medium text-fg">No results found</p>
            <p className="mt-1 text-xs text-muted">
              Try searching for something else
            </p>
          </div>
        )}

        {loaded && !debounced && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 rounded-2xl bg-muted/10 p-6">
              <Store size={40} className="text-muted" />
            </div>
            <p className="text-sm font-medium text-fg">
              Discover products from all merchants
            </p>
            <p className="mt-1 text-xs text-muted">
              Start typing to search across all stores
            </p>
          </div>
        )}

        {results.map((group) => (
          <div key={group.merchant.id} className="mb-4">
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-bg/90 py-2 backdrop-blur">
              <Store size={14} className="text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                {group.merchant.name}
              </span>
              <span className="text-xs text-muted">
                · {group.merchant.area}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {group.products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => goToMerchant(p.merchant_id, p.id)}
                  className="flex items-center justify-between rounded-2xl border border-border bg-surface p-3 text-left transition-colors hover:bg-elevated"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {p.name}
                    </p>
                    {p.description && (
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {p.description}
                      </p>
                    )}
                    <p className="mt-1 text-sm font-semibold text-go">
                      {formatUgx(p.price)}
                    </p>
                  </div>
                  <ArrowRight size={16} className="ml-3 shrink-0 text-muted" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
