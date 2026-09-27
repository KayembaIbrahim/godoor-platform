import { cn } from "@/lib/utils";

/**
 * GoDoor logo mark.
 *
 * Brand colours are hard-coded (never CSS variables) so the mark is
 * pixel-identical in light and dark mode. Only the optional wordmark
 * inherits a theme-aware colour.
 */
export function Logo({
  className,
  size = "md",
  markOnly = false,
  showWordmark = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  markOnly?: boolean;
  showWordmark?: boolean;
}) {
  const text = size === "lg" ? "text-[2rem] leading-none" : size === "sm" ? "text-[15px] leading-none" : "text-xl leading-none";
  const mark = size === "lg" ? 40 : size === "sm" ? 24 : 30;
  const gap = size === "lg" ? "gap-2.5" : size === "sm" ? "gap-1.5" : "gap-2";

  return (
    <span className={cn("inline-flex items-center", gap, className)}>
      <svg
        width={mark}
        height={mark}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Navy arrow / swoosh that carries the wordmark forward */}
        <path
          d="M8 44.5c0-11 8.5-19.5 20-19.5 8.6 0 15.3 4.2 18.4 10.2l-8.6 3.1c-1.7-2.6-5-4.3-9.4-4.3-6.2 0-11.2 4.7-11.2 10.5V54l-9.2-3.6V44.5Z"
          fill="#0F172A"
        />
        <path
          d="M56.4 8.6 48.2 7.2c-1.1-.2-2.2.5-2.4 1.6l-1.2 7.1c-.2 1.1.5 2.2 1.6 2.4l2 .3-9.3 11.4 6.6 5.4 9.3-11.4 1.4 1.9c.9 1.2 2.6 1.5 3.9.6L62 24.2c1.2-.9 1.5-2.6.6-3.9l-6.2-11.7Z"
          fill="#0F172A"
        />
        {/* Orange door leaf swinging open */}
        <path d="M13.5 12.5 30 8.2v41.6L13.5 45.5V12.5Z" fill="#F97316" />
        <path d="M30 8.2 45.5 12.5v33L30 49.8V8.2Z" fill="#EA580C" />
        <circle cx="21.5" cy="29" r="2.6" fill="#FFFFFF" />
      </svg>

      {showWordmark && !markOnly && (
        <span className={cn("inline-flex items-baseline font-display font-extrabold tracking-tight whitespace-nowrap", text)}>
          <span className="bg-gradient-to-r from-[#F97316] to-[#EA580C] bg-clip-text text-transparent">Go</span>
          <span className="text-fg">Door</span>
          <span className="ml-0.5 text-[0.34em] font-semibold text-muted align-super leading-none">™</span>
        </span>
      )}
    </span>
  );
}
