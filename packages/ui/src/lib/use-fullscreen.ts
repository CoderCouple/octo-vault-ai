// Detects macOS / OS-level fullscreen so we can remove the traffic-light
// inset (the buttons disappear in fullscreen).

import { useEffect, useState } from "react";

export function useIsFullscreen(): boolean {
  const [isFs, setIsFs] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(display-mode: fullscreen)").matches;
  });

  useEffect(() => {
    const mql = window.matchMedia("(display-mode: fullscreen)");
    const onChange = () => setIsFs(mql.matches);
    mql.addEventListener("change", onChange);
    // Also listen to standard fullscreenchange for browser fullscreen.
    const onFs = () => setIsFs(!!document.fullscreenElement || mql.matches);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      mql.removeEventListener("change", onChange);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  return isFs;
}
