// Lists every profile field, grouped by category, with the canonical
// value, source pill, confidence, and conflict marker. Sensitive fields
// require master-password unlock to reveal via MaskedValue.

import { useEffect, useState } from "react";
import {
  AlertTriangle, Briefcase, Columns2, GraduationCap, Plus, Pin, Rows, Trash2,
} from "lucide-react";
import {
  addUserCandidate,
  canonicalValue,
  normalizeValue,
  PROFILE_FIELDS,
  type ConflictState,
  type EducationRecord,
  type ExperienceRecord,
  type Profile,
  type ProfileKey,
} from "@octovault/core";
import { useAppContext } from "../context";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { MaskedValue } from "../components/SensitivityGate";
import { cn } from "../lib/utils";

const CATEGORIES = ["personal", "contact", "government_id", "employment", "emergency"] as const;
const CATEGORY_LABELS: Record<typeof CATEGORIES[number], string> = {
  personal: "Personal",
  contact: "Contact",
  government_id: "Government IDs",
  employment: "Employment",
  emergency: "Emergency",
};

const COLUMNS_KEY = "octovault.profileColumns";

export function ProfileView() {
  const { storage, readOnly, activeEntityId } = useAppContext();
  const [profile, setProfile] = useState<Profile>({});
  const [education, setEducation] = useState<EducationRecord[]>([]);
  const [experience, setExperience] = useState<ExperienceRecord[]>([]);
  const [editing, setEditing] = useState<ProfileKey | null>(null);
  const [draft, setDraft] = useState("");
  const [columns, setColumns] = useState<1 | 2>(() => (Number(localStorage.getItem(COLUMNS_KEY)) === 2 ? 2 : 1));

  async function refresh() {
    const [p, edu, exp] = await Promise.all([
      storage.getProfile(activeEntityId),
      storage.listEducation(activeEntityId),
      storage.listExperience(activeEntityId),
    ]);
    setProfile(p);
    setEducation(edu);
    setExperience(exp);
  }
  useEffect(() => { void refresh(); }, [storage, activeEntityId]);

  function setCols(n: 1 | 2) {
    setColumns(n);
    localStorage.setItem(COLUMNS_KEY, String(n));
  }

  async function commit(key: ProfileKey) {
    if (!draft.trim() || readOnly) return;
    await addUserCandidate(storage, activeEntityId, key, draft, normalizeValue);
    setEditing(null);
    setDraft("");
    await refresh();
  }

  const filledCount = Object.keys(profile).length;

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {filledCount}/{PROFILE_FIELDS.length} fields populated
        </span>
        <div className="flex items-center gap-0.5 rounded-md border p-0.5">
          <button
            onClick={() => setCols(1)}
            title="Single column"
            className={cn("rounded p-1", columns === 1 ? "bg-accent" : "hover:bg-accent/50")}
          >
            <Rows className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCols(2)}
            title="Two columns"
            className={cn("rounded p-1", columns === 2 ? "bg-accent" : "hover:bg-accent/50")}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat} className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABELS[cat]}
          </div>
          <Separator />
          <div className={cn("grid gap-1.5", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {PROFILE_FIELDS.filter((f) => f.category === cat).map((f) => {
            const record = profile[f.key];
            const canonical = record ? canonicalValue(record) : null;
            const isEditing = editing === f.key;
            const sensitive = f.sensitivity === "highly_sensitive";
            const state: ConflictState = record?.conflictState ?? "none";

            return (
              <Card
                key={f.key}
                className={cn(
                  "px-3 py-2",
                  state === "stale" && "status-stale",
                  state === "conflict" && "status-conflict",
                  state === "red_flag" && "status-redflag"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">{f.label}</span>
                  <div className="flex items-center gap-1">
                    {canonical?.userPinned && <Pin className="h-3 w-3 text-muted-foreground" />}
                    {state === "red_flag" && <AlertTriangle className="h-3.5 w-3.5" />}
                    {canonical && <Badge variant="outline">{canonical.confidence}</Badge>}
                    {record && record.candidates.length > 1 && (
                      <Badge variant="muted">{record.candidates.length} sources</Badge>
                    )}
                  </div>
                </div>

                {isEditing && !readOnly ? (
                  <div className="mt-1.5 flex gap-1.5">
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void commit(f.key); if (e.key === "Escape") setEditing(null); }}
                    />
                    <Button size="sm" onClick={() => void commit(f.key)}>Save</Button>
                  </div>
                ) : (
                  <div className="mt-0.5">
                    {canonical ? (
                      sensitive ? (
                        <MaskedValue value={canonical.value} />
                      ) : readOnly ? (
                        <span className="font-serif text-sm">{canonical.value}</span>
                      ) : (
                        <button
                          onClick={() => { setEditing(f.key); setDraft(canonical.value); }}
                          className="text-left font-serif text-sm hover:text-muted-foreground"
                        >
                          {canonical.value}
                        </button>
                      )
                    ) : readOnly ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-7 text-xs text-muted-foreground"
                        onClick={() => { setEditing(f.key); setDraft(""); }}
                      >
                        <Plus className="h-3 w-3" /> Add
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          </div>
        </div>
      ))}

      <RecordsSection
        title="Education"
        icon={GraduationCap}
        items={education}
        readOnly={readOnly}
        emptyText="No education records yet."
        onAdd={async () => {
          await storage.saveEducation({
            id: crypto.randomUUID(), entityId: activeEntityId,
            institution: "", source: { documentId: "user-entered" },
            extractedAt: Date.now(), userEdited: true, userPinned: true,
          });
          await refresh();
        }}
        onUpdate={async (id, patch) => {
          const existing = education.find((e) => e.id === id);
          if (!existing) return;
          await storage.saveEducation({ ...existing, ...patch, userEdited: true });
          await refresh();
        }}
        onDelete={async (id) => { await storage.deleteEducation(id); await refresh(); }}
        renderFields={(item, onChange) => (
          <>
            <RecordField label="Institution" value={item.institution} onChange={(v) => onChange({ institution: v })} />
            <div className="grid grid-cols-2 gap-2">
              <RecordField label="Degree" value={item.degree ?? ""} onChange={(v) => onChange({ degree: v })} />
              <RecordField label="Field" value={item.field ?? ""} onChange={(v) => onChange({ field: v })} />
              <RecordField label="Start" value={item.startDate ?? ""} onChange={(v) => onChange({ startDate: v })} />
              <RecordField label="End" value={item.endDate ?? ""} onChange={(v) => onChange({ endDate: v })} />
            </div>
          </>
        )}
        summary={(item) => `${item.degree ?? "Education"}${item.field ? ` in ${item.field}` : ""} — ${item.institution}${item.endDate ? ` (${item.endDate})` : ""}`}
      />

      <RecordsSection
        title="Experience"
        icon={Briefcase}
        items={experience}
        readOnly={readOnly}
        emptyText="No experience records yet."
        onAdd={async () => {
          await storage.saveExperience({
            id: crypto.randomUUID(), entityId: activeEntityId,
            company: "", role: "", source: { documentId: "user-entered" },
            extractedAt: Date.now(), userEdited: true, userPinned: true,
          });
          await refresh();
        }}
        onUpdate={async (id, patch) => {
          const existing = experience.find((e) => e.id === id);
          if (!existing) return;
          await storage.saveExperience({ ...existing, ...patch, userEdited: true });
          await refresh();
        }}
        onDelete={async (id) => { await storage.deleteExperience(id); await refresh(); }}
        renderFields={(item, onChange) => (
          <>
            <div className="grid grid-cols-2 gap-2">
              <RecordField label="Role" value={item.role} onChange={(v) => onChange({ role: v })} />
              <RecordField label="Company" value={item.company} onChange={(v) => onChange({ company: v })} />
              <RecordField label="Start" value={item.startDate ?? ""} onChange={(v) => onChange({ startDate: v })} />
              <RecordField label="End (or empty)" value={item.endDate ?? ""} onChange={(v) => onChange({ endDate: v })} />
            </div>
            <RecordField label="Location" value={item.location ?? ""} onChange={(v) => onChange({ location: v })} />
          </>
        )}
        summary={(item) => `${item.role} at ${item.company}${item.endDate ? ` (until ${item.endDate})` : item.startDate ? ` (since ${item.startDate})` : ""}`}
      />
    </div>
  );
}

interface RecordsSectionProps<T extends { id: string }> {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: T[];
  readOnly: boolean;
  emptyText: string;
  onAdd: () => Promise<void>;
  onUpdate: (id: string, patch: Partial<T>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  renderFields: (item: T, onChange: (patch: Partial<T>) => void) => React.ReactNode;
  summary: (item: T) => string;
}

function RecordsSection<T extends { id: string }>({
  title, icon: Icon, items, readOnly, emptyText, onAdd, onUpdate, onDelete, renderFields, summary,
}: RecordsSectionProps<T>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </div>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void onAdd()}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        )}
      </div>
      <Separator />
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <Card key={item.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="flex-1 text-left font-serif text-sm hover:text-muted-foreground"
                  >
                    {summary(item)}
                  </button>
                  {!readOnly && (
                    <Button size="icon" variant="ghost" onClick={() => void onDelete(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {expanded && !readOnly && (
                  <div className="mt-2 space-y-2 border-t pt-2">
                    {renderFields(item, (patch) => void onUpdate(item.id, patch as Partial<T>))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecordField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
    </div>
  );
}

