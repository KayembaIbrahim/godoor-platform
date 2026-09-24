"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

/** Pages that should show the marketing footer (public/marketing pages only). */
const FOOTER_VISIBLE_PATHS = ["/", "/help", "/terms", "/privacy", "/tutorial", "/setup", "/onboarding", "/partner"];

function shouldShowFooter(pathname: string): boolean {
  // Exact match for marketing pages + any /partner sub-route
  if (FOOTER_VISIBLE_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/partner")) return true;
  // Don't show on any app/dashboard/API pages
  return false;
}

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
  const pathname = usePathname();
  if (!shouldShowFooter(pathname)) return null;

  return (
    <footer className="border-t border-border bg-surface/50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <Logo size="md" />
            <p className="mt-3 text-xs text-dim leading-relaxed">Delivering possibilities across Uganda.</p>
            <p className="mt-2 text-[10px] text-dim">MTN MoMo · Airtel Money · Cash</p>
          </div>
          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-xs font-semibold text-fg uppercase tracking-wider">{title}</h4>
              <ul className="mt-3 space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:text-go transition">{link.label}</a>
                    ) : (
                      <Link href={link.href} className="text-xs text-muted hover:text-go transition">{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-border pt-6 text-[10px] text-dim md:flex-row">
          <p>&copy; {new Date().getFullYear()} GoDoor. A ZentechX company.</p>
          <p>Made in Uganda</p>
        </div>
      </div>
    </footer>
  );
}
