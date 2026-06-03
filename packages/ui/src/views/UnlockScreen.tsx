// Full-screen unlock prompt at app boot when the vault exists but the
// in-process key isn't loaded. Delegates the actual unlock to the
// host so each surface implements its own vault tech (WebCrypto+IDB
// for extension, SQLCipher via IPC for desktop).

import { useState } from "react";
import { Lock, Loader2, RotateCcw } from "lucide-react";
import { useAppContext } from "../context";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { OctoMark } from "../components/octo-mark";
import { BRAND, tx } from "../lib/brand";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";

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

  // Wipes the vault and lets VaultGate fall through to Onboarding. The
  // AlertDialog gives a final confirmation — there's no undo for this.
  async function reset() {
    setError(null);
    setBusy(true);
    try {
      await host.vaultReset();
      onUnlocked(); // unblocks VaultGate; vaultExists() is now false → Onboarding triggers
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

        {/* Last resort — forgot password. AlertDialog forces an explicit
            confirm because there's no undo: every document, entity, and
            extracted fact is wiped. */}
        <div className="flex justify-center">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                disabled={busy}
              >
                <RotateCcw className="h-3 w-3" /> Forgot password? Reset and start fresh
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset your vault?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes every document, entity, and extracted fact
                  stored on this device. The encryption key is gone — even we can't
                  recover this data afterwards. You'll be asked to pick a new master
                  password.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep my vault</AlertDialogCancel>
                <AlertDialogAction onClick={() => void reset()}>
                  Yes, wipe and start over
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
