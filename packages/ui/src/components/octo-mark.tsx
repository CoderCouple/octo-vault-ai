// OctoVault brand mark. An octagon (8 sides = "Octo") with a
// keyhole inside (vault). Monochrome — uses currentColor so it
// adapts to light/dark themes.

import { cn } from "../lib/utils";

interface OctoMarkProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export function OctoMark({ className, ...props }: OctoMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="OctoVault AI"
      className={cn("h-5 w-5", className)}
      {...props}
    >
      {/* Octagon outline — 8 sides for "Octo". */}
      <polygon
        points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Keyhole — vault symbolism. Filled. */}
      <circle cx="12" cy="11" r="1.75" fill="currentColor" />
      <path
        d="M11 12.5 L11 16.25 L13 16.25 L13 12.5 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Lockup: mark + wordmark side-by-side.
export function OctoLockup({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-semibold tracking-tight", className)}>
      <OctoMark className="h-4 w-4" />
      <span>OctoVault</span>
    </span>
  );
}
