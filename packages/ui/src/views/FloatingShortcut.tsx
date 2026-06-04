// Floating shortcut — a small always-on-top capsule the user can drag
// to any edge of the screen. Click toggles the Spotlight overlay (same
// surface as the ⌘⌥O hotkey). The whole window is the drag region;
// the button inside is no-drag so onClick fires instead of dragging.
//
// Visual is just the OctoMark badge (its own rounded square shape)
// with a drop-shadow filter on the SVG so the shadow follows the
// rounded outline instead of painting a rectangular halo.

import { OctoMark } from "../components/octo-mark";

interface OverlayBridge { hide: () => void; show: () => void; toggle: () => void }

function overlayBridge(): OverlayBridge | undefined {
  const w = window as unknown as { octovault?: { overlay?: OverlayBridge } };
  return w.octovault?.overlay;
}

export function FloatingShortcut() {
  return (
    <div
      style={{
        WebkitAppRegion: "drag",
        background: "transparent",
      } as React.CSSProperties}
      className="flex h-full w-full items-center justify-center"
    >
      <button
        type="button"
        onClick={() => overlayBridge()?.toggle()}
        style={{
          WebkitAppRegion: "no-drag",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.45)) drop-shadow(0 2px 4px rgba(0,0,0,0.25))",
        } as React.CSSProperties}
        title="OctoVault — click or press ⌘⌥O"
        className="transition-transform hover:scale-110 active:scale-95"
      >
        <OctoMark className="h-12 w-12" />
      </button>
    </div>
  );
}
