"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Logo } from "@/components/Logo";

/**
 * GoDoor marketing footer.
 *
 * ── Why it is folded by default ────────────────────────────────────────────
 * The full footer is four columns of links, a brand block and a legal strip.
 * On the welcome page — whose hero already fills a whole viewport — that
 * pushed the end of the page a long way past the fold, so the screen looked
 * like it simply had no end. The folded bar keeps the two things that have
 * to be on every page (the brand and the legal line) and hides the link
 * columns behind a "See more" disclosure.
 *
 * The folded state is the DEFAULT on the server AND on the client's first
 * render, so the two trees are identical and React has nothing to
 * reconcile. The disclosure only ever changes after a real click.
 *
 * ── Why it no longer decides for itself whether to show ───────────────────
 * It used to live in the root layout and pick its own routes with
 * `usePathname()`. That put a route-dependent client component inside the
 * SHARED layout shell, which Next.js cannot resolve for a statically
 * prerendered route: the footer was dropped from the server HTML and
 * delivered later as a separate streamed payload. The client's first render
 * then had a footer the server had never sent, React threw hydration error
 * #418, and it threw away the whole server-rendered page — the welcome
 * background artwork included.
 *
 * Each marketing page now includes the footer itself. It is part of that
 * page's own segment, so it is rendered with the correct route and arrives
 * in the very first byte of HTML the visitor receives.
 */

const FOOTER_LINKS: Record<string, { label: string; href: string; external?: boolean; }[]> = {
  Product: [
    { label: "Browse merchants", href: "/app" },
    { label: "How it works", href: "/how-it-works" },
    { label: "Tutorial", href: "/tutorial" },
    { label: "Help centre", href: "/help" },
  ],
  "For Business": [
    { label: "Register your shop", href: "/partner?role=business" },
    { label: "Business dashboard", href: "/business" },
  ],
  "For Riders": [
    { label: "Become a rider", href: "/partner?role=rider" },
    { label: "Rider dashboard", href: "/rider" },
  ],
  Company: [
    { label: "Terms of Service", href: "/terms" },
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Contact us", href: "mailto:support@godoor.site" },
    { label: "WhatsApp", href: "https://wa.me/256750685772?text=Hi%20GoDoor%2C%20I%20need%20help", external: true },
  ],
};

export function AppFooter() {
  const [expanded, setExpanded] = useState(false);

  return (
    <footer className="border-t border-border bg-surface/50">
      <div className="mx-auto max-w-5xl px-4 py-5">
        {/* Brand row — always visible, and it carries the disclosure. */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo size="sm" className="shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-xs text-muted">Delivering possibilities across Uganda.</p>
              <p className="mt-0.5 truncate text-[10px] text-dim">GoDoor Wallet</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs font-medium text-muted transition hover:text-fg"
          >
            {expanded ? "See less" : "See more"}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        </div>

        {/* Link columns — only rendered once the visitor asks for them. */}
        {expanded ? (
          <div className="mt-8 grid grid-cols-2 gap-8 md:grid-cols-4">
            {Object.entries(FOOTER_LINKS).map(([title, links]) => (
              <div key={title}>
                <h4 className="text-xs font-semibold text-fg uppercase tracking-wider">{title}</h4>
                <ul className="mt-3 space-y-2">
                  {links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center py-2 text-xs text-muted hover:text-go transition">{link.label}</a>
                      ) : (
                        <Link href={link.href} className="inline-flex min-h-11 items-center py-2 text-xs text-muted hover:text-go transition">{link.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col items-center justify-between gap-2 border-t border-border pt-4 text-[10px] text-dim md:flex-row">
          <p>&copy; {new Date().getFullYear()} GoDoor. A ZentechX company.</p>
          <p>Made in Uganda</p>
        </div>
      </div>
    </footer>
  );
}
