// OctoVault brand mark. An octagon (8 sides = "Octo") with a keyhole
// inside (vault). Filled-badge style — always a black rounded square
// with a white OctoMark inside, matching the favicon and the macOS app
// icon. The hardcoded colors (no currentColor / no theme tokens)
// guarantee identical look on every desktop / wallpaper / theme.

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
      {/* Black rounded-square badge background. */}
      <rect width="24" height="24" rx="4.5" fill="#0a0a0a" />
      {/* OctoMark in white, scaled to ~75% of the canvas so there's
          visible padding around the octagon. */}
      <g transform="translate(3 3) scale(0.75)">
        <polygon
          points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
          fill="none"
          stroke="#fafafa"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="11" r="1.85" fill="#fafafa" />
        <path
          d="M11 12.5 L11 16.25 L13 16.25 L13 12.5 Z"
          fill="#fafafa"
        />
      </g>
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
