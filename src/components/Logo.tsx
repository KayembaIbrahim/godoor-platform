import { cn } from "@/lib/utils";

/** GoDoor wordmark: polished door icon + "GoDoor" text. */
export function Logo({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-3xl" : size === "sm" ? "text-[15px]" : "text-xl";
  const svgSize = size === "lg" ? 32 : size === "sm" ? 22 : 26;
  const iconGap = size === "lg" ? "gap-2" : "gap-1.5";

  return (
    <span className={cn("inline-flex items-center font-display font-bold tracking-tight leading-none", iconGap, text, className)}>
      {/* Door icon mark */}
      <span className="inline-flex shrink-0 items-center drop-shadow-[0_2px_4px_rgba(241,90,34,0.35)]">
        <svg
          width={svgSize}
          height={svgSize}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Door frame */}
          <rect x="5" y="3" width="15" height="26" rx="2.5" fill="#f15a22" />
          {/* Inner door panel */}
          <rect x="6.5" y="4.5" width="12" height="23" rx="1.5" fill="#ff7a3d" />
          {/* Door knob */}
          <circle cx="17" cy="16" r="1.6" fill="#0b0712" />
          <circle cx="17" cy="16" r="0.8" fill="#ff7a3d" opacity="0.4" />
          {/* Open door panel (3D effect) */}
          <path d="M20 3L27 5.5V26.5L20 29V3Z" fill="#c13e10" />
          <path d="M21.5 4.5L25.5 6.5V25.5L21.5 27.5V4.5Z" fill="#d94e18" />
          {/* Door knob on open panel */}
          <circle cx="21.5" cy="16" r="1" fill="#ff7a3d" opacity="0.3" />
        </svg>
      </span>
      <span className="whitespace-nowrap">
        <span className="text-gradient">Go</span>
        <span className="text-fg">Door</span>
      </span>
      <span className="ml-0.5 text-[0.35em] font-semibold text-muted align-super leading-none">™</span>
    </span>
  );
}
