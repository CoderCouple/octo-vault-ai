// Full-screen unlock prompt at app boot when the vault exists but the
// in-process key isn't loaded. Delegates the actual unlock to the
// host so each surface implements its own vault tech (WebCrypto+IDB
// for extension, SQLCipher via IPC for desktop).

import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { useAppContext } from "../context";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { OctoMark } from "../components/octo-mark";
import { BRAND, tx } from "../lib/brand";

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { host } = useAppContext();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setError(null);
    setBusy(true);
    try {
      const ok = await host.vaultUnlock(password);
      if (!ok) { setError("Wrong password. Try again."); return; }
      onUnlocked();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-svh w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <OctoMark className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className={tx.h2}>{BRAND.name}</h1>
            <p className={tx.muted}>{BRAND.slogan}</p>
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void unlock(); }}
          className="space-y-3 rounded-lg border bg-card p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="vault-pw" className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Master password
            </Label>
            <Input
              id="vault-pw" type="password" autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <div className="text-xs text-foreground">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Unlock vault
          </Button>
        </form>

        <p className={`text-center ${tx.muted}`}>
          Your vault is encrypted with this password. We can't recover it for you.
        </p>
      </div>
    </div>
  );
}
