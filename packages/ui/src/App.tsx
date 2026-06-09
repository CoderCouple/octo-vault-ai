import { useEffect, useState } from "react";
import {
  FileText, UserCircle2, AlertTriangle, Network, MessageSquare, Users, Settings as SettingsIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Badge } from "./components/ui/badge";
import { useAppContext } from "./context";
import { ThemeProvider } from "./components/theme";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from "./components/ui/sidebar";
import { OctoMark } from "./components/octo-mark";
import { useIsFullscreen } from "./lib/use-fullscreen";
import { BRAND } from "./lib/brand";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "./components/ui/breadcrumb";
import { Separator } from "./components/ui/separator";
import { Documents } from "./views/Documents";
import { ProfileView } from "./views/Profile";
import { Conflicts } from "./views/Conflicts";
import { FactsGraph } from "./views/FactsGraph";
import { SettingsView } from "./views/Settings";
import { Onboarding } from "./views/Onboarding";
import { Entities } from "./views/Entities";
import { Chat } from "./views/Chat";
import { UnlockScreen } from "./views/UnlockScreen";

export type AppLayout = "popup" | "full";

type ViewId = "documents" | "profile" | "conflicts" | "facts" | "chat" | "entities" | "settings";

const NAV: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }>; group: "vault" | "intelligence" | "manage" }[] = [
  { id: "documents", label: "Documents", icon: FileText, group: "vault" },
  { id: "profile",   label: "Profile",   icon: UserCircle2, group: "vault" },
  { id: "conflicts", label: "Conflicts", icon: AlertTriangle, group: "vault" },
  { id: "facts",     label: "Facts",     icon: Network, group: "intelligence" },
  { id: "chat",      label: "Chat",      icon: MessageSquare, group: "intelligence" },
  { id: "entities",  label: "Entities",  icon: Users, group: "manage" },
  { id: "settings",  label: "Settings",  icon: SettingsIcon, group: "manage" },
];

const GROUPS: { id: "vault" | "intelligence" | "manage"; label: string }[] = [
  { id: "vault", label: "Vault" },
  { id: "intelligence", label: "Intelligence" },
  { id: "manage", label: "Manage" },
];

export function App(props: { layout?: AppLayout }) {
  return (
    <ThemeProvider>
      <AppInner {...props} />
    </ThemeProvider>
  );
}

function AppInner({ layout = "popup" }: { layout?: AppLayout }) {
  return (
    <VaultGate>
      {layout === "popup" ? <PopupLayout /> : <FullLayout />}
    </VaultGate>
  );
}

// Block the app behind the unlock screen if a vault exists and isn't
// already unlocked in this session. Uses the host's vault methods so
// both extension (WebCrypto + IDB) and desktop (SQLCipher via IPC)
// surfaces follow the same flow.
function VaultGate({ children }: { children: React.ReactNode }) {
  const { host } = useAppContext();
  const [needsUnlock, setNeedsUnlock] = useState<boolean | null>(null);

  // Same dev escape hatch as Onboarding — includes chrome-extension://
  // so the side panel's unlock prompt is dismissable while iterating.
  const isDev = typeof location !== "undefined" && (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.protocol === "file:" ||
    location.protocol === "chrome-extension:"
  );

  useEffect(() => {
    void (async () => {
      if (localStorage.getItem("octovault.skipUnlock") === "1") {
        setNeedsUnlock(false);
        return;
      }
      // When a read-only source (e.g. the desktop bridge) is
      // available, the extension doesn't need its own vault unlocked
      // to function — it's just viewing data via the read-only
      // adapter. Settings + auth blob lookups remain plaintext on
      // the host's own storage so the source-switcher pill still
      // works if the user wants to flip later.
      if (host.sources) {
        for (const src of host.sources) {
          if (!src.readOnly) continue;
          try {
            if (!src.isAvailable || (await src.isAvailable())) {
              setNeedsUnlock(false);
              return;
            }
          } catch { /* probe failed; ignore */ }
        }
      }
      const exists = await host.vaultExists();
      if (!exists) { setNeedsUnlock(false); return; }
      setNeedsUnlock(!host.isVaultUnlocked());
    })();
  }, [host]);

  if (needsUnlock === null) return null;
  if (needsUnlock) return (
    <UnlockScreen
      onUnlocked={() => setNeedsUnlock(false)}
      onSkip={isDev ? () => {
        try { localStorage.setItem("octovault.skipUnlock", "1"); } catch { /* ignore */ }
        setNeedsUnlock(false);
      } : undefined}
    />
  );
  return <>{children}</>;
}

// --- Side panel (extension) — fills the panel's full height; width
// follows whatever the user has dragged the panel to. Tabs are still
// across the top because the panel is too narrow for a left sidebar.

function PopupLayout() {
  const { host, settings } = useAppContext();
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    void (async () => setOllamaOk(await host.isOllamaReachable()))();
  }, [host]);

  // Mandatory onboarding: show until the Self entity has a real name + email.
  // Two bypasses:
  //   - Dev escape hatch via localStorage.octovault.skipOnboarding.
  //   - When a read-only source (desktop bridge) is available, the user
  //     has already onboarded on the canonical surface — don't double-
  //     onboard them in the extension.
  const { entities: ctxEntities, host: gateHost } = useAppContext();
  useEffect(() => {
    if (localStorage.getItem("octovault.skipOnboarding") === "1") {
      setShowOnboarding(false);
      return;
    }
    void (async () => {
      if (gateHost.sources) {
        for (const src of gateHost.sources) {
          if (!src.readOnly) continue;
          try {
            if (!src.isAvailable || (await src.isAvailable())) {
              setShowOnboarding(false);
              return;
            }
          } catch { /* ignore */ }
        }
      }
      const self = ctxEntities.find((e) => e.id === "self");
      const customized = self && self.name !== "Self" && (self.email?.length ?? 0) > 0;
      setShowOnboarding(!customized);
    })();
  }, [ctxEntities, gateHost]);

  return (
    <div className="flex h-screen w-full flex-col overflow-x-hidden">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <OctoMark className="h-4 w-4" />
          <span className="text-sm font-semibold tracking-tight">{BRAND.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={ollamaOk ? "outline" : "muted"}>
            {ollamaOk === null ? "Checking" : ollamaOk ? "Ollama" : "Offline"}
          </Badge>
          <SourcePill />
        </div>
      </header>
      <Tabs defaultValue="chat" className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-3 py-2">
          {/* Six tabs at default Chrome side-panel width (~360px).
              Each gets icon + label; flex-1 distributes the row. */}
          <TabsList className="w-full">
            <TabsTrigger value="chat" className="flex-1" title="Chat">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Chat</span>
            </TabsTrigger>
            <TabsTrigger value="facts" className="flex-1" title="Facts graph">
              <Network className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Facts</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex-1" title="Documents">
              <FileText className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Docs</span>
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-1" title="Profile">
              <UserCircle2 className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Profile</span>
            </TabsTrigger>
            <TabsTrigger value="conflicts" className="flex-1" title="Conflicts">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Conflicts</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1" title="Settings">
              <SettingsIcon className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Settings</span>
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <TabsContent value="chat"      className="m-0 h-full"><Chat /></TabsContent>
          <TabsContent value="facts"     className="m-0 h-full"><FactsGraph /></TabsContent>
          <TabsContent value="documents" className="m-0 h-full"><Documents /></TabsContent>
          <TabsContent value="profile"   className="m-0 h-full"><ProfileView /></TabsContent>
          <TabsContent value="conflicts" className="m-0 h-full"><Conflicts /></TabsContent>
          <TabsContent value="settings"  className="m-0 h-full"><SettingsView /></TabsContent>
        </div>
      </Tabs>
      <footer className="border-t px-4 py-1.5 text-[10px] text-muted-foreground">
        Processed on this device · {settings.ollamaUrl}
      </footer>
      {showOnboarding && (
        <Onboarding onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}

// --- Desktop — collapsible sidebar + top SiteHeader with breadcrumb.

function FullLayout() {
  const { host, settings } = useAppContext();
  const [view, setView] = useState<ViewId>("documents");
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const isFullscreen = useIsFullscreen();

  useEffect(() => {
    void (async () => setOllamaOk(await host.isOllamaReachable()))();
  }, [host]);

  // Mandatory onboarding: show until the Self entity has a real name + email.
  // Two bypasses:
  //   - Dev escape hatch via localStorage.octovault.skipOnboarding.
  //   - When a read-only source (desktop bridge) is available, the user
  //     has already onboarded on the canonical surface — don't double-
  //     onboard them in the extension.
  const { entities: ctxEntities, host: gateHost } = useAppContext();
  useEffect(() => {
    if (localStorage.getItem("octovault.skipOnboarding") === "1") {
      setShowOnboarding(false);
      return;
    }
    void (async () => {
      if (gateHost.sources) {
        for (const src of gateHost.sources) {
          if (!src.readOnly) continue;
          try {
            if (!src.isAvailable || (await src.isAvailable())) {
              setShowOnboarding(false);
              return;
            }
          } catch { /* ignore */ }
        }
      }
      const self = ctxEntities.find((e) => e.id === "self");
      const customized = self && self.name !== "Self" && (self.email?.length ?? 0) > 0;
      setShowOnboarding(!customized);
    })();
  }, [ctxEntities, gateHost]);

  const activeNav = NAV.find((n) => n.id === view)!;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          {/* In windowed mode, leave a drag strip the height of macOS
              traffic-lights so the brand doesn't sit underneath them.
              In fullscreen, lights are gone — hug the top edge. */}
          {!isFullscreen && (
            <div
              className="h-3 w-full shrink-0"
              style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            />
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <div className="flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <OctoMark className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 leading-none group-data-[state=collapsed]/sidebar:hidden">
                  <span className="truncate font-medium">{BRAND.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{BRAND.slogan}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {GROUPS.map((g) => (
            <SidebarGroup key={g.id}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarMenu>
                {NAV.filter((n) => n.group === g.id).map((n) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton isActive={view === n.id} tooltip={n.label} onClick={() => setView(n.id)}>
                      <n.icon className="h-4 w-4 shrink-0" />
                      <span className="group-data-[state=collapsed]/sidebar:hidden">{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-muted-foreground group-data-[state=collapsed]/sidebar:hidden">
            <span>v0.0.1</span>
            <Badge variant={ollamaOk ? "outline" : "muted"}>
              {ollamaOk ? "Ollama" : "Offline"}
            </Badge>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <SiteHeader activeLabel={activeNav.label} ollamaOk={ollamaOk} />
        <div className="flex-1 overflow-auto">
          {view === "documents" && <Documents />}
          {view === "profile"   && <ProfileView />}
          {view === "conflicts" && <Conflicts />}
          {view === "facts"     && <FactsGraph />}
          {view === "chat"      && <Chat />}
          {view === "entities"  && <Entities />}
          {view === "settings"  && <SettingsView />}
        </div>
        <footer className="border-t px-4 py-1.5 text-[10px] text-muted-foreground">
          Processed on this device · {settings.ollamaUrl}
        </footer>
      </SidebarInset>

      {showOnboarding && (
        <Onboarding onClose={() => setShowOnboarding(false)} />
      )}
    </SidebarProvider>
  );
}

function SiteHeader({ activeLabel, ollamaOk }: { activeLabel: string; ollamaOk: boolean | null }) {
  const { activeEntityId, entities, setActiveEntityId } = useAppContext();
  const entity = entities.find((e) => e.id === activeEntityId);
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><span className="text-muted-foreground">{BRAND.name}</span></BreadcrumbItem>
          {entity && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <button
                  className="rounded px-1.5 py-0.5 text-sm hover:bg-accent"
                  onClick={() => {
                    if (entities.length < 2) return;
                    const i = entities.findIndex((e) => e.id === activeEntityId);
                    const next = entities[(i + 1) % entities.length];
                    setActiveEntityId(next.id);
                  }}
                  title="Switch entity"
                >
                  {entity.name}
                </button>
              </BreadcrumbItem>
            </>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{activeLabel}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1.5">
        <Badge variant={ollamaOk ? "outline" : "muted"}>
          {ollamaOk === null ? "Checking" : ollamaOk ? "Ollama ready" : "Ollama offline"}
        </Badge>
        <SourcePill />
      </div>
    </header>
  );
}

function SourcePill() {
  const { sources, source, setSourceId } = useAppContext();
  if (sources.length === 0 || !source) return <Badge variant="muted">Local</Badge>;
  const next = sources[(sources.indexOf(source) + 1) % sources.length];
  return (
    <button onClick={() => setSourceId(next.id)} title={`Switch to ${next.label}`} className="inline-flex">
      <Badge variant={source.readOnly ? "outline" : "muted"}>
        {source.label}{source.readOnly ? " · Read-only" : ""}
      </Badge>
    </button>
  );
}

