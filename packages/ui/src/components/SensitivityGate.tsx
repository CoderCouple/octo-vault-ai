// Wraps any content that reveals a highly-sensitive field. Requires
// master-password re-auth before showing the value. Tracks unlock
// state in app context so users don't re-enter the password every
// time within a session.

import { useState, type ReactNode } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import {
  createAuthBlob, deserializeAuthBlob, serializeAuthBlob, verifyPassword,
} from "@octovault/core";
import { useAppContext } from "../context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./ui/dialog";

export function SensitivityGate({
  value,
  children,
}: {
  value: string;
  children: (revealed: boolean, toggle: () => void) => ReactNode;
}) {
  const { settings, setSettings, unlocked, unlock, host } = useAppContext();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealLocal, setRevealLocal] = useState(false);

  if (!settings.requireUnlockForSensitive) {
    return <>{children(true, () => undefined)}</>;
  }

  function toggle() {
    if (revealLocal) { setRevealLocal(false); return; }
    if (unlocked) { setRevealLocal(true); return; }
    setOpen(true);
  }

  async function submit() {
    setError(null);
    try {
      const existing = await host.storage.getAuthBlob();
      if (!existing) {
        if (password.length < 8) { setError("Use at least 8 characters."); return; }
        const blob = await createAuthBlob(password);
        await host.storage.setAuthBlob(serializeAuthBlob(blob));
        await setSettings({ hasMasterPassword: true });
      } else {
        const blob = deserializeAuthBlob(existing);
        const ok = await verifyPassword(password, blob);
        if (!ok) { setError("Incorrect password."); return; }
      }
      unlock();
      setRevealLocal(true);
      setPassword("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      {children(revealLocal, toggle)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Unlock sensitive fields
            </DialogTitle>
            <DialogDescription>
              {settings.hasMasterPassword
                ? `Enter your master password to reveal ${redactPreview(value)}.`
                : "Set a master password. Used only on this device to gate highly-sensitive values."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="master-pw">Master password</Label>
            <Input
              id="master-pw"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            />
            {error && <div className="text-xs text-destructive">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void submit()}>
              {settings.hasMasterPassword ? "Unlock" : "Set & unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MaskedValue({ value }: { value: string }) {
  return (
    <SensitivityGate value={value}>
      {(revealed, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-2 font-mono text-sm hover:text-foreground"
        >
          <span>{revealed ? value : mask(value)}</span>
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </SensitivityGate>
  );
}

function mask(v: string): string {
  if (v.length <= 4) return "•".repeat(v.length);
  return "•".repeat(Math.max(4, v.length - 4)) + v.slice(-4);
}

function redactPreview(v: string): string {
  return "the value ending in " + v.slice(-3);
}
