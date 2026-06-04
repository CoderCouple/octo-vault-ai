// Floating shortcut — small always-on-top capsule. Drag to reposition;
// click toggles the Spotlight overlay (same surface as ⌘⌥O).
//
// Drag is JS-driven because CSS -webkit-app-region: drag can't coexist
// with onClick on the same element. The trick that makes it actually
// smooth: once mousedown fires on the button, the mousemove and
// mouseup listeners get attached to `document` (not the button). If
// they were on the button, the window moving faster than the cursor
// would briefly take the cursor off the button → mouseleave fires →
// drag state resets mid-drag → feels sticky / stringent. Document
// listeners run regardless of where the cursor is.

import { useRef } from "react";
import { OctoMark } from "../components/octo-mark";

interface OverlayBridge { hide: () => void; show: () => void; toggle: () => void }
interface ShortcutBridge {
  move: (x: number, y: number) => void;
  snap: () => void;
  contextMenu: () => void;
}

function bridges() {
  const w = window as unknown as {
    octovault?: { overlay?: OverlayBridge; shortcut?: ShortcutBridge };
  };
  return { overlay: w.octovault?.overlay, shortcut: w.octovault?.shortcut };
}

const DRAG_THRESHOLD_PX = 4;

export function FloatingShortcut() {
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

    function onMove(ev: MouseEvent) {
      if (!dragStart.current) return;
      const dx = ev.screenX - dragStart.current.mouseX;
      const dy = ev.screenY - dragStart.current.mouseY;
      if (!isDragging.current && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        isDragging.current = true;
        document.body.style.cursor = "grabbing";
      }
      if (isDragging.current) {
        bridges().shortcut?.move(dragStart.current.winX + dx, dragStart.current.winY + dy);
      }
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      if (!dragStart.current) return;
      if (isDragging.current) {
        bridges().shortcut?.snap(); // immediate snap on release
      } else {
        bridges().overlay?.toggle(); // unmoved press = click
      }
      dragStart.current = null;
      isDragging.current = false;
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      onContextMenu={(e) => { e.preventDefault(); bridges().shortcut?.contextMenu(); }}
      title="OctoVault — click to open, drag to move, right-click for menu"
      style={{
        background: "transparent",
        backgroundColor: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        appearance: "none",
        WebkitAppearance: "none",
        WebkitTapHighlightColor: "transparent",
        cursor: "grab",
        filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.45)) drop-shadow(0 2px 4px rgba(0,0,0,0.25))",
      } as React.CSSProperties}
      className="flex h-full w-full items-center justify-center transition-transform active:scale-95 focus:outline-none focus-visible:outline-none"
    >
      <OctoMark className="h-12 w-12" />
    </button>
  );
}
