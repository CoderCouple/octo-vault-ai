// CRUD for the people in this vault. Each entity has a name and a
// relationship. The "self" entity is special — name is editable but
// the entity cannot be deleted and its relationship stays "self".

import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import {
  initialsFor, SELF_ENTITY_ID,
  type Entity, type Relationship,
} from "@octovault/core";
import { useAppContext } from "../context";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { cn } from "../lib/utils";

const RELATIONSHIPS: Relationship[] = [
  "self", "spouse", "partner", "child", "parent", "sibling", "dependent", "other",
];

export function Entities() {
  const {
    storage, entities, activeEntityId, setActiveEntityId,
    refreshEntities, refreshDocuments, readOnly, documents,
  } = useAppContext();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; relationship: Relationship }>({ name: "", relationship: "spouse" });
  const [pendingDelete, setPendingDelete] = useState<Entity | null>(null);

  async function createEntity() {
    if (!draft.name.trim() || readOnly) return;
    const entity: Entity = {
      id: crypto.randomUUID(),
      name: draft.name.trim(),
      relationship: draft.relationship,
      initials: initialsFor(draft.name),
      createdAt: Date.now(),
    };
    await storage.saveEntity(entity);
    await refreshEntities();
    setCreating(false);
    setDraft({ name: "", relationship: "spouse" });
  }

  async function renameEntity(e: Entity, name: string) {
    if (readOnly) return;
    await storage.saveEntity({ ...e, name: name.trim(), initials: initialsFor(name) });
    await refreshEntities();
  }

  async function changeRelationship(e: Entity, r: Relationship) {
    if (readOnly || e.id === SELF_ENTITY_ID) return;
    await storage.saveEntity({ ...e, relationship: r });
    await refreshEntities();
  }

  async function confirmDelete(e: Entity) {
    await storage.deleteEntity(e.id);
    await refreshEntities();
    await refreshDocuments();
    if (activeEntityId === e.id) setActiveEntityId(SELF_ENTITY_ID);
    setPendingDelete(null);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">Entities</h2>
          <p className="text-sm text-muted-foreground">
            People in this vault. Documents are tagged to one entity at import time.
          </p>
        </div>
        {!readOnly && (
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> {creating ? "Cancel" : "Add entity"}
          </Button>
        )}
      </div>

      {creating && (
        <Card className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g., Payal Tiwari" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Relationship</Label>
              <select
                value={draft.relationship}
                onChange={(e) => setDraft({ ...draft, relationship: e.target.value as Relationship })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {RELATIONSHIPS.filter((r) => r !== "self").map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void createEntity()}>Create</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {entities.map((e) => (
          <EntityCard
            key={e.id}
            entity={e}
            active={e.id === activeEntityId}
            docCount={documents.filter((d) => d.entityId === e.id).length}
            readOnly={readOnly}
            onActivate={() => setActiveEntityId(e.id)}
            onRename={(n) => void renameEntity(e, n)}
            onChangeRelationship={(r) => void changeRelationship(e, r)}
            onDelete={() => setPendingDelete(e)}
          />
        ))}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the entity and every document and fact attached to them. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void confirmDelete(pendingDelete)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EntityCard({
  entity, active, docCount, readOnly,
  onActivate, onRename, onChangeRelationship, onDelete,
}: {
  entity: Entity;
  active: boolean;
  docCount: number;
  readOnly: boolean;
  onActivate: () => void;
  onRename: (n: string) => void;
  onChangeRelationship: (r: Relationship) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(entity.name);
  const isSelf = entity.id === SELF_ENTITY_ID;

  return (
    <Card
      onClick={onActivate}
      className={cn(
        "cursor-pointer space-y-3 p-4 transition-colors hover:bg-accent/30",
        active && "ring-1 ring-foreground"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card text-xs font-medium">
          {entity.initials}
        </div>
        <div className="min-w-0 flex-1">
          {editingName && !readOnly ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { onRename(nameDraft); setEditingName(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onRename(nameDraft); setEditingName(false); }
                if (e.key === "Escape") { setNameDraft(entity.name); setEditingName(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7"
            />
          ) : (
            <button
              className="truncate text-left text-base font-medium hover:text-muted-foreground disabled:hover:text-foreground"
              disabled={readOnly}
              onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
            >
              {entity.name}
            </button>
          )}
          <div className="mt-0.5 flex items-center gap-1.5">
            <Badge variant={isSelf ? "outline" : "muted"}>{entity.relationship}</Badge>
            <Badge variant="muted">{docCount} doc{docCount === 1 ? "" : "s"}</Badge>
            {active && <Badge variant="outline">active</Badge>}
          </div>
        </div>
        {!readOnly && !isSelf && (
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete entity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {!readOnly && !isSelf && (
        <div onClick={(e) => e.stopPropagation()}>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Relationship</Label>
          <select
            value={entity.relationship}
            onChange={(e) => onChangeRelationship(e.target.value as Relationship)}
            className="mt-1 flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
          >
            {RELATIONSHIPS.filter((r) => r !== "self").map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}

// Empty state if no entities exist (shouldn't happen — self is auto-created).
export function EntitiesEmpty() {
  return (
    <div className="p-6 text-center">
      <Users className="mx-auto h-6 w-6 text-muted-foreground" />
      <div className="mt-2 text-sm font-medium">No entities yet</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Import a document and OctoVault will identify the person it's about.
      </div>
    </div>
  );
}
