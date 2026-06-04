// Floating shortcut — a small always-on-top capsule the user can drag
// to any edge of the screen. Click toggles the Spotlight overlay (same
// surface as the ⌘⌥O hotkey).
//
// CSS -webkit-app-region: drag was a dead end here: the button covers
// the whole window, marking it no-drag (required for onClick to fire)
// makes the window effectively undraggable. So we run drag in JS:
// track mousedown→mousemove deltas in screen coords, push them to
// the main process via shortcut.move(x, y), and let it setPosition
// the BrowserWindow. Mouseup snaps to the nearer edge.

import { useRef } from "react";
import { OctoMark } from "../components/octo-mark";

interface OverlayBridge { hide: () => void; show: () => void; toggle: () => void }
interface ShortcutBridge { move: (x: number, y: number) => void; snap: () => void }

function bridges() {
  const w = window as unknown as {
    octovault?: { overlay?: OverlayBridge; shortcut?: ShortcutBridge };
  };
  return { overlay: w.octovault?.overlay, shortcut: w.octovault?.shortcut };
}

const DRAG_THRESHOLD_PX = 4;

export function FloatingShortcut() {
  // Mutable drag bookkeeping kept in refs — we don't want re-renders
  // on every mousemove, and the drag state isn't shown in the UI.
  const dragStart = useRef<{ mouseX: number; mouseY: number; winX: number; winY: number } | null>(null);
  const isDragging = useRef(false);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragStart.current = {
      mouseX: e.screenX,
      mouseY: e.screenY,
      winX: window.screenX,
      winY: window.screenY,
    };
    isDragging.current = false;
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragStart.current) return;
    const dx = e.screenX - dragStart.current.mouseX;
    const dy = e.screenY - dragStart.current.mouseY;
    if (!isDragging.current && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
      isDragging.current = true;
    }
    if (isDragging.current) {
      bridges().shortcut?.move(dragStart.current.winX + dx, dragStart.current.winY + dy);
    }
  }

  function onMouseUp() {
    if (!dragStart.current) return;
    if (isDragging.current) {
      bridges().shortcut?.snap(); // immediate edge-snap on release
    } else {
      bridges().overlay?.toggle(); // unmoved mousedown→up = a click
    }
    dragStart.current = null;
    isDragging.current = false;
  }

  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}      // reset if cursor leaves mid-drag
      title="OctoVault — click to open, drag to move"
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "grab",
        filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.45)) drop-shadow(0 2px 4px rgba(0,0,0,0.25))",
      } as React.CSSProperties}
      className="flex h-full w-full items-center justify-center transition-transform active:scale-95"
    >
      <OctoMark className="h-12 w-12" />
    </button>
  );
}
