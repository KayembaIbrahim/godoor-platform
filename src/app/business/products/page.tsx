"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Package, Plus, Trash2, Edit3, Save, X, ArrowLeft, Search,
  UtensilsCrossed, ShoppingCart, Pill, Shirt, FileText, Loader2, ToggleLeft, ToggleRight,
  CheckCircle
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import { fetchMerchants, fetchProducts, saveProduct, deleteProduct, apiAuthHeaders, type DBProduct } from "@/lib/db";
import { CATEGORIES, getCategoryIcon, getCategoryColor } from "@/lib/categories";

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export default function BusinessProductsPage() {
  const { profile, supabaseUser } = useSession();
  const [products, setProducts] = useState<DBProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [addSuccess, setAddSuccess] = useState(false);
  const [showCatPicker, setShowCatPicker] = useState(false);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCategory, setFormCategory] = useState(profile.category || CATEGORIES[0].id);
  const [formBulky, setFormBulky] = useState(false);
  const [formIsService, setFormIsService] = useState(false);
  const [formDuration, setFormDuration] = useState("30");
  const [formImages, setFormImages] = useState<string[]>([]);
  const [uploadingImg, setUploadingImg] = useState(false);

  const [merchantRecord, setMerchantRecord] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const merchants = await fetchMerchants();
      const uid = supabaseUser?.id;
      const email = supabaseUser?.email || profile.email;
      const bName = profile.businessName;
      // Robust merchant lookup: owner_id → owner email → business name
      const my = uid ? merchants.find((m) => m.owner_id === uid)
        || merchants.find((m) => (m.momo_name || "").toLowerCase() === (email || "").toLowerCase())
        || merchants.find((m) => m.name && bName && m.name.toLowerCase() === bName.toLowerCase())
        : merchants.find((m) => m.name && bName && m.name.toLowerCase() === bName.toLowerCase());
      if (my) {
        setMerchantId(my.id);
        setMerchantRecord(my);
        const prods = await fetchProducts(my.id);
        setProducts(prods);
      }
      setLoading(false);
    })();
  }, [supabaseUser?.id, profile.email, profile.businessName]);

  const persist = async (action: "add" | "update" | "delete" | "toggle", product?: Omit<DBProduct, "created_at">) => {
    setSaving(true);
    if (action === "delete" && product) {
      await deleteProduct(product.id);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
    } else if (action === "toggle" && product) {
      const updated: DBProduct = { ...product, created_at: (product as DBProduct).created_at ?? Date.now(), available: !product.available };
      await saveProduct(updated);
      setProducts((prev) => prev.map((p) => p.id === product.id ? updated : p));
    } else if ((action === "add" || action === "update") && product) {
      const saved = await saveProduct({ ...product, merchant_id: merchantId || "" });
      if (saved) {
        if (action === "add") setProducts((prev) => [...prev, saved]);
        else setProducts((prev) => prev.map((p) => p.id === saved.id ? saved : p));
      }
    }
    setSaving(false);
  };

  const addProduct = async () => {
    if (!formName.trim()) return;
    if (!formPrice || Number(formPrice) <= 0) return;
    if (!merchantId) {
      setFormError("Business lookup failed. Try refreshing, or check you created the business first.");
      return;
    }
    const colors = getCategoryColor(formCategory);
    const images = formImages.filter(Boolean).slice(0, 10);
    const p: Omit<DBProduct, "created_at"> = {
      id: `p_${Date.now().toString(36)}`,
      merchant_id: merchantId,
      name: formName.trim(),
      description: formDesc.trim(),
      price: Number(formPrice),
      category: formCategory,
      image_url: images[0] || "",
      images: images.length ? images : undefined,
      available: true,
      sort_order: products.length,
      bulky: formBulky,
      is_service: formIsService,
      duration_minutes: formIsService ? Math.max(0, Math.floor(Number(formDuration) || 0)) : 0,
    };
    await persist("add", p);
    setAddSuccess(true);
    resetForm();
    setShowAdd(false);
    setTimeout(() => setAddSuccess(false), 2500);
  };

  const updateProduct = async (id: string) => {
    if (!merchantId) return;
    const existing = products.find((p) => p.id === id);
    if (!existing) return;
    const colors = getCategoryColor(formCategory);
    const updated: Omit<DBProduct, "created_at"> = {
      ...existing,
      name: formName,
      description: formDesc,
      price: Number(formPrice),
      category: formCategory,
      bulky: formBulky,
      is_service: formIsService,
      duration_minutes: formIsService ? Math.max(0, Math.floor(Number(formDuration) || 0)) : 0,
      image_url: (formImages[0]) || existing.image_url,
      images: formImages.length ? formImages.slice(0,10) : existing.images,
    };
    await persist("update", updated);
    setEditing(null);
    resetForm();
  };

  const handleProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 10 - formImages.length);
    if (files.length === 0) return;
    setUploadingImg(true);
    const urls: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", "product-images");
      fd.append("path", `products/${merchantId || "misc"}/${Date.now()}.${file.name.split(".").pop()}`);
      try {
        const res = await fetch("/api/upload", { method: "POST", headers: await apiAuthHeaders(false), body: fd });
        const json = await res.json().catch(() => ({}));
        if (json.url) urls.push(json.url);
      } catch {}
    }
    if (urls.length) {
      setFormImages((prev) => [...prev, ...urls].slice(0, 10));
    }
    setUploadingImg(false);
    if (e.target) e.target.value = "";
  };

  const resetForm = () => {
    setFormName(""); setFormDesc(""); setFormPrice("");
    setFormCategory(merchantRecord?.category || profile.category || CATEGORY_IDS[0]);
    setFormBulky(false); setFormIsService(false); setFormDuration("30"); setFormImages([]); setFormError("");
  };

  const startEdit = (p: DBProduct) => {
    setEditing(p.id);
    setFormName(p.name);
    setFormDesc(p.description);
    setFormPrice(String(p.price));
    setFormCategory(p.category);
    setFormBulky(p.bulky === true);
    setFormIsService(p.is_service === true);
    setFormDuration(p.is_service ? String(p.duration_minutes || 30) : "30");
    setFormImages(p.images && p.images.length ? p.images.slice(0, 10) : (p.image_url ? [p.image_url] : []));
    setShowAdd(false);
  };

  const filtered = products.filter((p) => {
    if (q.trim()) {
      const s = q.toLowerCase();
      return p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s);
    }
    return true;
  });

  const activeCount = products.filter((p) => p.available).length;

  return (<>
    <div className="mx-auto min-h-screen max-w-6xl bg-bg pb-24 px-4 md:px-6">
      {/* Header */}
      <div className="border-b border-border bg-surface/50 px-4 py-4">
        <div className="flex items-center gap-3">
          <Link href="/business" className="text-muted hover:text-fg transition"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="flex-1">
            <h1 className="font-display text-lg font-bold">Products</h1>
            <p className="text-[10px] text-muted">{profile.businessName || "My Business"} · {activeCount} active / {products.length} total</p>
          </div>
          <button type="button" onClick={() => { resetForm(); setShowAdd(true); setEditing(null); }}
            className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {/* Search */}
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="w-full rounded-xl border border-border bg-bg py-2.5 pl-10 pr-3 text-sm outline-none ring-primary focus:ring-2" />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      )}

      {/* Add / Edit form */}
      {!loading && (showAdd || editing) && (
        <div className="mx-4 mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">{editing ? "Edit product" : "Add product"}</h3>
            <button type="button" onClick={() => { setShowAdd(false); setEditing(null); resetForm(); }} className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-2">
            {/* Category — uses the business's own category (no unrelated categories shown) */}
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2.5">
              {(() => { const CatIcon = getCategoryIcon(formCategory); return <CatIcon className="h-4 w-4 shrink-0 text-primary" />; })()}
              <div className="flex-1">
                <p className="text-xs font-medium text-fg">{formCategory}</p>
                <p className="text-[9px] text-dim">Category set from your business profile</p>
              </div>
              <button type="button" onClick={() => setShowCatPicker(!showCatPicker)}
                className="rounded-lg bg-elevated px-2 py-1 text-[10px] font-medium text-muted hover:bg-panel transition">Change</button>
            </div>
            {showCatPicker && (
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-surface p-2">
                {CATEGORY_IDS.map((c) => {
                  const CatIcon = getCategoryIcon(c);
                  return (
                    <button key={c} type="button" onClick={() => { setFormCategory(c); setShowCatPicker(false); }}
                      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-medium transition ${
                        formCategory === c ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted hover:bg-elevated"
                      }`}>
                      <CatIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Product name"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" />
            <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Short description"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" />
            <input type="number" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} placeholder="Price (UGX)"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" />

            {merchantRecord?.business_type === "clinic" && (
              <div className="space-y-2">
                <button type="button" onClick={() => { setFormIsService(!formIsService); if (!formIsService) setFormBulky(false); }}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                    formIsService ? "border-primary/40 bg-primary/10" : "border-border bg-bg"
                  }`}>
                  <div>
                    <p className="text-sm font-medium text-fg">Bookable service</p>
                    <p className="text-[10px] text-muted">Patients book this — priced per visit, not per item</p>
                  </div>
                  <div className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${formIsService ? "bg-primary" : "bg-border"}`}>
                    <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${formIsService ? "translate-x-5.5" : "translate-x-0.5"}`} />
                  </div>
                </button>
                {formIsService && (
                  <div>
                    <label className="text-[10px] text-muted">Appointment duration (minutes)</label>
                    <div className="mt-1 flex gap-1.5">
                      {[15, 30, 45, 60].map((m) => (
                        <button key={m} type="button" onClick={() => setFormDuration(String(m))}
                          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${Number(formDuration) === m ? "bg-primary text-white" : "bg-bg text-muted"}`}>{m}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Heavy / bulky toggle */}
            <button type="button" onClick={() => setFormBulky(!formBulky)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                formBulky ? "border-warning/40 bg-warning/10" : "border-border bg-bg"
              }`}>
              <div>
                <p className="text-sm font-medium text-fg">Heavy / bulky item</p>
                <p className="text-[10px] text-muted">Adds a {`UGX 5,000`} surcharge per item on delivery (sofas, fridges…)</p>
              </div>
              <div className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${formBulky ? "bg-warning" : "bg-border"}`}>
                <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${formBulky ? "translate-x-5.5" : "translate-x-0.5"}`} />
              </div>
            </button>

            {/* Multi-image upload — up to 10 */}
            <div>
              <label className="flex items-center justify-between text-[10px] text-muted">
                <span>Product photos ({formImages.length}/10)</span>
                {formImages.length > 0 && <span className="text-dim">Tap × to remove</span>}
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {formImages.map((url, i) => (
                  <div key={url + i} className="relative h-14 w-14 rounded-lg overflow-hidden ring-1 ring-border group">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => setFormImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute inset-0 grid place-items-center bg-black/0 text-transparent hover:bg-black/40 hover:text-white transition">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {formImages.length < 10 && (
                  <label className="grid h-14 w-14 place-items-center rounded-lg border-2 border-dashed border-border bg-bg text-dim cursor-pointer hover:border-primary/40 hover:text-primary transition">
                    {uploadingImg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleProductImage} disabled={uploadingImg} />
                  </label>
                )}
              </div>
              <p className="mt-1 text-[9px] text-dim">You can upload up to 10 photos per product. First photo is the cover.</p>
            </div>
          </div>

          {formError && (
            <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] font-medium text-danger">{formError}</p>
          )}
          {addSuccess && (
            <p className="mt-2 rounded-lg bg-success/15 px-3 py-2 text-[11px] font-medium text-success flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5" /> Product saved
            </p>
          )}

          <button type="button" onClick={() => editing ? updateProduct(editing) : addProduct()}
            disabled={!formName.trim() || !formPrice || saving || uploadingImg}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-40 transition">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {editing ? "Save changes" : "Add product"}
          </button>
        </div>
      )}

      {/* Products list */}
      {!loading && (
        <div className="px-4 pt-4">
          {filtered.length === 0 && products.length === 0 ? (
            <div className="py-12 text-center animate-fade-in">
              <Package className="mx-auto h-8 w-8 text-dim" />
              <p className="mt-2 text-sm font-medium text-fg">No products yet</p>
              <p className="text-xs text-muted">Add your first product to start receiving orders</p>
              <button type="button" onClick={() => setShowAdd(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary/90 transition">
                <Plus className="h-3.5 w-3.5" /> Add first product
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No products match search</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const CatIcon = getCategoryIcon(p.category) || Package;
              const colors = getCategoryColor(p.category);
              return (
                <div key={p.id} className={`rounded-2xl border bg-surface p-3.5 transition ${p.available ? "border-border" : "border-border opacity-50"}`}>
                  <div className="flex items-start gap-3">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl overflow-hidden ${colors.bg}`}>
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <CatIcon className={`h-5 w-5 ${colors.text}`} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{p.name}</p>
                        {p.bulky === true && <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning">Heavy</span>}
                        {!p.available && <span className="text-[9px] text-danger font-medium">Sold out</span>}
                      </div>
                      <p className="text-[11px] text-dim truncate">{p.description || "No description"}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-sm font-bold text-primary tabular-nums">UGX {p.price.toLocaleString()}</span>
                        <span className="text-[9px] text-dim">{p.category}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-1.5 border-t border-border pt-2.5">
                    <button type="button" onClick={() => persist("toggle", p)}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${p.available ? "bg-success/15 text-success hover:bg-success/25" : "bg-elevated text-muted hover:bg-panel"}`}>
                      {p.available ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
                      {p.available ? "Active" : "Inactive"}
                    </button>
                    <button type="button" onClick={() => startEdit(p)}
                      className="flex items-center gap-1 rounded-lg bg-elevated px-2.5 py-1.5 text-[10px] font-medium text-muted hover:bg-panel transition">
                      <Edit3 className="h-3 w-3" /> Edit
                    </button>
                    <button type="button" onClick={() => persist("delete", p)}
                      className="flex items-center gap-1 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[10px] font-medium text-danger hover:bg-danger/20 transition">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}