// Shows every field with more than one live candidate, grouped by
// severity. User can pin the correct value, dismiss bad candidates,
// or wipe the whole FieldRecord when every candidate is bad.

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Eraser, Pin, Trash2 } from "lucide-react";
import {
  canonicalValue, dismissCandidate, fieldByKey, pinCandidate,
  type FieldRecord, type Profile,
} from "@octovault/core";
import { useAppContext } from "../context";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { cn } from "../lib/utils";

export function Conflicts() {
  const { storage, documents, readOnly, activeEntityId } = useAppContext();
  const [profile, setProfile] = useState<Profile>({});
  const [pendingFieldDelete, setPendingFieldDelete] = useState<FieldRecord | null>(null);

  async function refresh() { setProfile(await storage.getProfile(activeEntityId)); }
  useEffect(() => { void refresh(); }, [storage, activeEntityId]);

  const conflicts = Object.values(profile).filter(
    (r): r is FieldRecord => !!r && r.conflictState !== "none"
  );

  const redFlags = conflicts.filter((r) => r.conflictState === "red_flag");
  const others   = conflicts.filter((r) => r.conflictState !== "red_flag");

  const docName = (id: string) =>
    id === "user-entered" ? "You" : (documents.find((d) => d.id === id)?.name ?? "Unknown");

  async function pin(record: FieldRecord, candidateId: string) {
    await pinCandidate(storage, activeEntityId, record.key, candidateId);
    await refresh();
  }
  async function drop(record: FieldRecord, candidateId: string) {
    await dismissCandidate(storage, activeEntityId, record.key, candidateId);
    await refresh();
  }
  async function confirmDeleteField(record: FieldRecord) {
    setPendingFieldDelete(null);
    await storage.deleteRecord(activeEntityId, record.key);
    await refresh();
  }

  if (conflicts.length === 0) {
    return (
      <div className="p-6 text-center">
        <Check className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="mt-2 text-sm font-medium">No conflicts</div>
        <div className="mt-1 text-xs text-muted-foreground">
          All your documents agree on every extracted field.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      {redFlags.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Red flags ({redFlags.length})
          </div>
          <p className="text-[11px] text-muted-foreground">
            These fields should never differ across documents. Verify the source documents
            before trusting either value — it could be a typo, an OCR error, or a sign of
            a serious data problem.
          </p>
          {redFlags.map((r) => (
            <ConflictCard key={r.key} record={r} docName={docName} onPin={pin} onDrop={drop}
              onDeleteField={() => setPendingFieldDelete(r)} readOnly={readOnly} />
          ))}
        </section>
      )}

      {others.length > 0 && (
        <section className="space-y-2">
          <div className="text-xs font-medium">To review ({others.length})</div>
          {others.map((r) => (
            <ConflictCard key={r.key} record={r} docName={docName} onPin={pin} onDrop={drop}
              onDeleteField={() => setPendingFieldDelete(r)} readOnly={readOnly} />
          ))}
        </section>
      )}

      <AlertDialog open={!!pendingFieldDelete} onOpenChange={(o) => !o && setPendingFieldDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingFieldDelete ? fieldByKey(pendingFieldDelete.key).label : "field"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Wipes every candidate for this field — including the canonical value. The
              source documents stay intact, so a re-extract or a new import can repopulate
              the field cleanly.
            </AlertDialogDescription>
            {pendingFieldDelete && (
              <p className="mt-2 text-xs text-muted-foreground">
                {pendingFieldDelete.candidates.filter((c) => !c.dismissedAt).length} candidate
                {pendingFieldDelete.candidates.filter((c) => !c.dismissedAt).length === 1 ? "" : "s"} will be removed.
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingFieldDelete && void confirmDeleteField(pendingFieldDelete)}>
              Delete field
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConflictCard({
  record, docName, onPin, onDrop, onDeleteField, readOnly,
}: {
  record: FieldRecord;
  docName: (id: string) => string;
  onPin: (r: FieldRecord, id: string) => void;
  onDrop: (r: FieldRecord, id: string) => void;
  onDeleteField: () => void;
  readOnly: boolean;
}) {
  const field = fieldByKey(record.key);
  const live = record.candidates.filter((c) => !c.dismissedAt);
  const canonical = canonicalValue(record);

  const stateClass =
    record.conflictState === "red_flag" ? "status-redflag"
    : record.conflictState === "conflict" ? "status-conflict"
    : "status-stale";

  return (
    <Card className={cn("space-y-2 p-3", stateClass)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{field.label}</div>
        <div className="flex items-center gap-1">
          <Badge variant="outline">{record.conflictState.replace("_", " ")}</Badge>
          {!readOnly && (
            <Button size="icon" variant="ghost" onClick={onDeleteField}
              title="Delete this field — wipe every candidate">
              <Eraser className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {live.map((c) => {
          const isCanonical = c.id === canonical?.id;
          return (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded border bg-card px-2 py-1.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{c.value}</span>
                  {isCanonical && <Badge variant="outline">canonical</Badge>}
                  {c.userPinned && <Pin className="h-3 w-3" />}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {docName(c.source.documentId)} · {c.docType} · {c.confidence}
                  {c.source.excerpt && ` · "${c.source.excerpt.slice(0, 60)}${c.source.excerpt.length > 60 ? "…" : ""}"`}
                </div>
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  {!c.userPinned && (
                    <Button size="icon" variant="ghost" onClick={() => onPin(record, c.id)} title="Pin as canonical">
                      <Pin className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => onDrop(record, c.id)} title="Dismiss">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
