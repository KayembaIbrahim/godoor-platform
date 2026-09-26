import {
  Beef,
  Building2,
  Flame,
  Home,
  Package,
  Pill,
  ShoppingBag,
  Stethoscope,
  FileText,
  Smartphone,
} from "lucide-react";
import type { Merchant } from "@/lib/catalog";

/** Map a merchant to a themed icon + warm accent color block for card graphics. */
export function merchantVisual(m: Merchant) {
  switch (m.category) {
    case "food":
      return {
        icon: m.id === "mcht_grill" ? Flame : m.id === "mcht_rolex" ? Beef : Home,
        tint: "from-primary/20 to-primary/5",
        ring: "ring-primary/30",
      };
    case "groceries":
      return {
        icon: ShoppingBag,
        tint: "from-[#22c55e]/20 to-[#16a34a]/5",
        ring: "ring-[#22c55e]/30",
      };
    case "pharmacy":
      return {
        icon: Pill,
        tint: "from-[#38bdf8]/20 to-[#0284c7]/5",
        ring: "ring-[#38bdf8]/30",
      };
    case "packages":
      return {
        icon: Package,
        tint: "from-[#a78bfa]/20 to-[#7c3aed]/5",
        ring: "ring-[#a78bfa]/30",
      };
    case "shopping":
      return {
        icon: Building2,
        tint: "from-[#f472b6]/20 to-[#db2777]/5",
        ring: "ring-[#f472b6]/30",
      };
    case "documents":
      return {
        icon: FileText,
        tint: "from-[#fbbf24]/20 to-[#d97706]/5",
        ring: "ring-[#fbbf24]/30",
      };
    default:
      return {
        icon: Smartphone,
        tint: "from-[#5b21b6]/20 to-[#6d28d9]/5",
        ring: "ring-[#5b21b6]/30",
      };
  }
}

export { Stethoscope };
