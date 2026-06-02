// Lightweight sidebar primitives modelled on shadcn's Sidebar. Covers
// the cases OctoVault needs: collapsible to icon-only, persistent state,
// keyboard shortcut, and an inset content area. No mobile sheet — the
// desktop window is always wide enough.

import * as React from "react";
import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Separator } from "./separator";

interface SidebarCtx {
  state: "expanded" | "collapsed";
  toggle: () => void;
  setState: (s: "expanded" | "collapsed") => void;
}

const Ctx = React.createContext<SidebarCtx | null>(null);

export function useSidebar(): SidebarCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useSidebar must be used inside SidebarProvider");
  return c;
}

const STORAGE_KEY = "octovault.sidebar";

export function SidebarProvider({
  defaultOpen = true,
  children,
  style,
}: {
  defaultOpen?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const [state, setStateInternal] = React.useState<"expanded" | "collapsed">(() => {
    if (typeof window === "undefined") return defaultOpen ? "expanded" : "collapsed";
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "expanded" || saved === "collapsed") return saved;
    return defaultOpen ? "expanded" : "collapsed";
  });

  const setState = React.useCallback((s: "expanded" | "collapsed") => {
    setStateInternal(s);
    localStorage.setItem(STORAGE_KEY, s);
  }, []);

  const toggle = React.useCallback(() => {
    setState(state === "expanded" ? "collapsed" : "expanded");
  }, [state, setState]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); toggle(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <Ctx.Provider value={{ state, toggle, setState }}>
      <div
        data-state={state}
        style={{ "--sidebar-width": "17.6rem", "--sidebar-width-icon": "3.5rem", ...style } as React.CSSProperties}
        className="group/sidebar-wrapper flex h-svh w-full overflow-hidden has-[[data-state=collapsed]]:[--sidebar-width:var(--sidebar-width-icon)]"
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function Sidebar({ children, className }: { children: React.ReactNode; className?: string }) {
  const { state } = useSidebar();
  return (
    <aside
      data-state={state}
      data-collapsible={state === "collapsed" ? "icon" : ""}
      style={{ width: state === "collapsed" ? "var(--sidebar-width-icon)" : "var(--sidebar-width)" }}
      className={cn(
        "group/sidebar relative h-svh shrink-0 border-r bg-card text-card-foreground transition-[width] duration-200 ease-linear",
        className
      )}
    >
      <div className="flex h-full flex-col gap-2 overflow-y-auto overflow-x-hidden">
        {children}
      </div>
    </aside>
  );
}

export function SidebarInset({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main className={cn("relative flex h-svh min-w-0 flex-1 flex-col overflow-hidden bg-background", className)}>
      {children}
    </main>
  );
}

export function SidebarHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 p-2", className)}>{children}</div>;
}

export function SidebarFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-auto flex flex-col gap-2 p-2", className)}>{children}</div>;
}

export function SidebarContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto", className)}>{children}</div>;
}

export function SidebarGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-1 p-2", className)}>{children}</div>;
}

export function SidebarGroupLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  const { state } = useSidebar();
  if (state === "collapsed") return null;
  return <div className={cn("px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</div>;
}

export function SidebarMenu({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn("flex flex-col gap-0.5", className)}>{children}</ul>;
}

export function SidebarMenuItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <li className={cn("relative", className)}>{children}</li>;
}

interface MenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  tooltip?: string;
  size?: "sm" | "default" | "lg";
  asChild?: boolean;
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, MenuButtonProps>(
  ({ isActive, tooltip, className, size = "default", asChild, children, ...props }, ref) => {
    const { state } = useSidebar();
    const sizeClasses =
      size === "sm" ? "h-7 text-xs"
      : size === "lg" ? "h-12 text-sm"
      : "text-sm py-1.5";

    const inner = (
      <>
        {children}
      </>
    );

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string; title?: string; "data-active"?: boolean }>;
      return React.cloneElement(child, {
        className: cn(
          "flex w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
          "data-[active=true]:bg-accent data-[active=true]:font-medium",
          state === "collapsed" && "justify-center px-0",
          sizeClasses,
          child.props.className,
          className,
        ),
        title: state === "collapsed" ? tooltip : child.props.title,
        "data-active": isActive,
      });
    }

    return (
      <button
        ref={ref}
        title={state === "collapsed" ? tooltip : undefined}
        data-active={isActive}
        className={cn(
          "flex w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
          "data-[active=true]:bg-accent data-[active=true]:font-medium",
          state === "collapsed" && "justify-center px-0",
          sizeClasses,
          className,
        )}
        {...props}
      >
        {inner}
      </button>
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export function SidebarTrigger({ className }: { className?: string }) {
  const { toggle, state } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={cn("h-8 w-8", className)}
      title={state === "expanded" ? "Collapse sidebar (⌘B)" : "Expand sidebar (⌘B)"}
    >
      <PanelLeft className="h-4 w-4" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
}

export function SidebarRail() {
  const { toggle, state } = useSidebar();
  return (
    <button
      onClick={toggle}
      title="Toggle sidebar"
      className="group/rail absolute inset-y-0 right-0 z-20 hidden w-2 -translate-x-px cursor-ew-resize transition-all hover:bg-border sm:flex"
    >
      <span className="sr-only">Toggle sidebar</span>
      {state === "expanded" ? <ChevronLeft className="m-auto h-3 w-3 opacity-0 group-hover/rail:opacity-50" /> : <ChevronRight className="m-auto h-3 w-3 opacity-0 group-hover/rail:opacity-50" />}
    </button>
  );
}

export function SidebarSeparator({ className }: { className?: string }) {
  return <Separator className={cn("mx-2 w-auto", className)} />;
}

export const SidebarMenuLabel = SidebarGroupLabel;
