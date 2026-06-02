// Interactive node-and-edge graph of extracted facts and their sources.
// - Documents (left column) and facts (right column) are draggable nodes.
// - Edges go doc → fact; click the × that appears on hover to dismiss
//   that document as a source for that fact.
// - Fact values are editable inline: click the value to edit; Enter to
//   save (creates a user-pinned candidate); Esc to cancel.
// Pan, zoom, click-a-node to dim un-connected nodes. Monochrome only.

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, MarkerType,
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Check, FileText, Pencil, ScanLine, Users, X } from "lucide-react";
import {
  addUserCandidate, canonicalValue, deriveFacts, derivedRelationshipEdges,
  dismissCandidate, fieldByKey, initialsFor, normalizeValue,
  type ConflictState, type Entity, type FieldRecord, type ProfileKey,
  type StoredDocument, type VaultProfile,
} from "@octovault/core";
import { useAppContext } from "../context";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";

interface DocNodeData extends Record<string, unknown> {
  doc: StoredDocument;
  focused?: boolean;
}
interface FactNodeData extends Record<string, unknown> {
  fieldKey: ProfileKey;
  entityId: string;
  entityName: string;
  entityInitials: string;
  label: string;
  value: string;
  sourcesCount: number;
  conflict: ConflictState;
  focused?: boolean;
  onSave: (next: string) => Promise<void>;
}
interface EntityNodeData extends Record<string, unknown> {
  entity: Entity;
  factCount: number;
  focused?: boolean;
}
interface EdgeData extends Record<string, unknown> {
  onDelete?: () => Promise<void>;
}

const NODE_TYPES = { document: DocumentNode, fact: FactNode, entity: EntityNode };
const EDGE_TYPES = { deletable: DeletableEdge };

type ViewMode = "source" | "entity";
const VIEW_KEY = "octovault.factsGraph.viewMode";

export function FactsGraph() {
  const { storage, documents, readOnly, entities } = useAppContext();
  const [vault, setVault] = useState<VaultProfile>({});
  const [viewMode, setViewModeState] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) as ViewMode | null) ?? "source"
  );
  const setViewMode = (m: ViewMode) => { setViewModeState(m); localStorage.setItem(VIEW_KEY, m); };

  const refresh = useCallback(async () => {
    setVault(await storage.getAllProfiles());
  }, [storage]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onSaveFact = useCallback(
    async (entityId: string, key: ProfileKey, next: string) => {
      const trimmed = next.trim();
      if (!trimmed || readOnly) return;
      await addUserCandidate(storage, entityId, key, trimmed, normalizeValue);
      await refresh();
    },
    [storage, readOnly, refresh]
  );

  const onDeleteCandidate = useCallback(
    async (entityId: string, key: ProfileKey, candidateId: string) => {
      if (readOnly) return;
      await dismissCandidate(storage, entityId, key, candidateId);
      await refresh();
    },
    [storage, readOnly, refresh]
  );

  const derived = useMemo(
    () => deriveFacts({ entities, vault }),
    [entities, vault]
  );

  const { initialNodes, initialEdges } = useMemo(
    () => viewMode === "entity"
      ? buildGraphByEntity(entities, vault, onSaveFact, derivedRelationshipEdges(derived))
      : buildGraph(documents, entities, vault, onSaveFact, onDeleteCandidate),
    [viewMode, documents, entities, vault, onSaveFact, onDeleteCandidate, derived]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => { setNodes(initialNodes); setEdges(initialEdges); },
    [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback((_e: unknown, node: Node) => {
    setNodes((ns) =>
      ns.map((n) => ({ ...n, data: { ...n.data, focused: relevantTo(node.id, n.id, edges) } }))
    );
  }, [edges, setNodes]);

  if (documents.length === 0 || Object.values(vault).every((p) => !p || Object.keys(p).length === 0)) {
    return (
      <div className="p-6 text-center">
        <div className="text-sm font-medium">Nothing to graph yet</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Import documents to see how every fact connects to its source.
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* View-mode toggle */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-sm">
        <button
          onClick={() => setViewMode("source")}
          title="By source — documents linked to facts"
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
            viewMode === "source" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          )}
        >
          <FileText className="h-3 w-3" /> By source
        </button>
        <button
          onClick={() => setViewMode("entity")}
          title="By entity — facts grouped by person"
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
            viewMode === "entity" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          )}
        >
          <Users className="h-3 w-3" /> By entity
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        elementsSelectable
        className="bg-background"
      >
        <Background gap={20} size={1} color="hsl(var(--border))" />
        <Controls
          showInteractive={false}
          className="!border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground hover:[&>button]:!bg-accent"
        />
      </ReactFlow>
    </div>
  );
}

function buildGraph(
  documents: StoredDocument[],
  entities: Entity[],
  vault: VaultProfile,
  onSaveFact: (entityId: string, key: ProfileKey, next: string) => Promise<void>,
  onDeleteCandidate: (entityId: string, key: ProfileKey, candidateId: string) => Promise<void>,
): { initialNodes: Node[]; initialEdges: Edge[] } {
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Flatten every entity's records into a single list of fact records
  // tagged with the owning entity.
  const visible: { entityId: string; record: FieldRecord }[] = [];
  for (const [entityId, profile] of Object.entries(vault)) {
    if (!profile) continue;
    for (const r of Object.values(profile)) {
      if (!r || !r.candidates.some((c) => !c.dismissedAt)) continue;
      visible.push({ entityId, record: r });
    }
  }

  // Group facts by entity in the layout so each person's facts cluster.
  visible.sort((a, b) => a.entityId.localeCompare(b.entityId) || a.record.key.localeCompare(b.record.key));

  const docNodes: Node<DocNodeData>[] = documents.map((d, i) => ({
    id: `doc:${d.id}`,
    type: "document",
    position: { x: 40, y: 40 + i * 96 },
    data: { doc: d },
  }));

  const factNodes: Node<FactNodeData>[] = visible.map(({ entityId, record: r }, i) => {
    const canonical = canonicalValue(r);
    const field = fieldByKey(r.key);
    const entity = entityById.get(entityId);
    return {
      id: `fact:${entityId}:${r.key}`,
      type: "fact",
      position: { x: 700, y: 40 + i * 72 },
      data: {
        fieldKey: r.key,
        entityId,
        entityName: entity?.name ?? entityId,
        entityInitials: entity?.initials ?? initialsFor(entityId),
        label: field.label,
        value: canonical?.value ?? "",
        sourcesCount: r.candidates.filter((c) => !c.dismissedAt).length,
        conflict: r.conflictState,
        onSave: (next: string) => onSaveFact(entityId, r.key, next),
      },
    };
  });

  const edges: Edge<EdgeData>[] = [];
  for (const { entityId, record: r } of visible) {
    for (const c of r.candidates.filter((x) => !x.dismissedAt)) {
      if (c.source.documentId === "user-entered") continue;
      const isCanonical = c.id === canonicalValue(r)?.id;
      const isConflict = r.conflictState !== "none";
      edges.push({
        id: `e:${c.id}`,
        type: "deletable",
        source: `doc:${c.source.documentId}`,
        target: `fact:${entityId}:${r.key}`,
        data: { onDelete: () => onDeleteCandidate(entityId, r.key, c.id) },
        style: {
          stroke: "hsl(var(--foreground))",
          strokeOpacity: isCanonical ? 0.75 : isConflict ? 0.35 : 0.5,
          strokeWidth: c.confidence === "high" ? 1.5 : 1,
          strokeDasharray: !isCanonical && isConflict ? "4 4" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--foreground))", width: 12, height: 12 },
      });
    }
  }

  return { initialNodes: [...docNodes, ...factNodes], initialEdges: edges };
}

// Entity-centric layout: one column per entity. Entity node at the top
// of the column, its facts stacked below grouped by category. Family
// relationships (spouse, parent, child) drawn as edges between entity
// nodes.
function buildGraphByEntity(
  entities: Entity[],
  vault: VaultProfile,
  onSaveFact: (entityId: string, key: ProfileKey, next: string) => Promise<void>,
  derivedEdges: import("@octovault/core").DerivedFact[] = [],
): { initialNodes: Node[]; initialEdges: Edge[] } {
  const COL_WIDTH = 320;
  const ROW_HEIGHT = 60;
  const ENTITY_TOP = 20;
  const FACTS_TOP = 160;

  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Keep self first, then the rest in created order.
  const ordered = [...entities].sort((a, b) => {
    if (a.id === "self") return -1;
    if (b.id === "self") return 1;
    return a.createdAt - b.createdAt;
  });

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  ordered.forEach((entity, colIdx) => {
    const x = 60 + colIdx * COL_WIDTH;

    const profile = vault[entity.id] ?? {};
    const records = Object.values(profile)
      .filter((r): r is FieldRecord => !!r && r.candidates.some((c) => !c.dismissedAt));

    // Group records by their schema category for visual clustering.
    records.sort((a, b) => {
      const fa = fieldByKey(a.key);
      const fb = fieldByKey(b.key);
      if (fa.category !== fb.category) return fa.category.localeCompare(fb.category);
      return a.key.localeCompare(b.key);
    });

    // Entity node at top of the column.
    nodes.push({
      id: `entity:${entity.id}`,
      type: "entity",
      position: { x, y: ENTITY_TOP },
      data: { entity, factCount: records.length },
    } as Node<EntityNodeData>);

    // Fact nodes below, with an edge from entity → each fact.
    records.forEach((r, i) => {
      const canonical = canonicalValue(r);
      const field = fieldByKey(r.key);
      const factId = `fact:${entity.id}:${r.key}`;
      nodes.push({
        id: factId,
        type: "fact",
        position: { x, y: FACTS_TOP + i * ROW_HEIGHT },
        data: {
          fieldKey: r.key,
          entityId: entity.id,
          entityName: entity.name,
          entityInitials: entity.initials,
          label: field.label,
          value: canonical?.value ?? "",
          sourcesCount: r.candidates.filter((c) => !c.dismissedAt).length,
          conflict: r.conflictState,
          onSave: (next: string) => onSaveFact(entity.id, r.key, next),
        },
      } as Node<FactNodeData>);

      edges.push({
        id: `e-of:${entity.id}:${r.key}`,
        source: `entity:${entity.id}`,
        target: factId,
        type: "smoothstep",
        style: {
          stroke: "hsl(var(--foreground))",
          strokeOpacity: 0.4,
          strokeWidth: 1,
        },
      });
    });
  });

  // Derived relationship edges (computed by derive.ts):
  // co-parent, sibling, parent-in-law, sibling-in-law, grandparent.
  // Rendered with a dotted line so the user knows they're inferred,
  // not asserted.
  for (const d of derivedEdges) {
    if (!d.object) continue;
    edges.push({
      id: `e-derived:${d.id}`,
      source: `entity:${d.subject}`,
      target: `entity:${d.object}`,
      type: "smoothstep",
      label: `${d.kind.replace(/-/g, " ")} (derived)`,
      labelStyle: { fontSize: 9, fill: "hsl(var(--muted-foreground))", fontStyle: "italic" },
      labelBgStyle: { fill: "hsl(var(--background))" },
      labelBgPadding: [4, 2],
      style: {
        stroke: "hsl(var(--muted-foreground))",
        strokeOpacity: 0.6,
        strokeWidth: 1,
        strokeDasharray: "1 4",
      },
    });
  }

  // Family relationship edges between entities.
  for (const e of entities) {
    const target = entityById.get(e.id);
    if (!target) continue;
    const isRelative = e.relationship !== "self" && e.relationship !== "other";
    const selfEntity = entityById.get("self");
    if (!isRelative || !selfEntity || e.id === "self") continue;
    // Draw spouse / partner / child / parent etc. as labelled edges
    // from self to the relative.
    edges.push({
      id: `e-fam:${e.id}`,
      source: `entity:self`,
      target: `entity:${e.id}`,
      type: "smoothstep",
      label: e.relationship,
      labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
      labelBgStyle: { fill: "hsl(var(--card))" },
      labelBgPadding: [4, 2],
      style: {
        stroke: "hsl(var(--foreground))",
        strokeOpacity: 0.6,
        strokeWidth: 1.5,
        strokeDasharray: "2 3",
      },
    });
  }

  return { initialNodes: nodes, initialEdges: edges };
}

function relevantTo(clickedId: string, nodeId: string, edges: Edge[]): boolean {
  if (clickedId === nodeId) return true;
  return edges.some(
    (e) => (e.source === clickedId && e.target === nodeId) ||
           (e.target === clickedId && e.source === nodeId)
  );
}

function EntityNode({ data }: NodeProps) {
  const { entity, factCount, focused } = data as EntityNodeData;
  return (
    <div
      className={cn(
        "w-[260px] rounded-lg border-2 bg-card px-3 py-2.5 text-card-foreground shadow-sm",
        focused === false && "opacity-40",
        focused === true ? "border-foreground" : "border-border"
      )}
    >
      {/* Family edges: incoming on the left, outgoing on the right. */}
      <Handle id="fam-l" type="target" position={Position.Left} className="!h-2 !w-2 !border-foreground !bg-foreground" />
      <Handle id="fam-r" type="source" position={Position.Right} className="!h-2 !w-2 !border-foreground !bg-foreground" />
      {/* Fact edges hang off the bottom of the entity node. */}
      <Handle id="facts" type="source" position={Position.Bottom} className="!h-2 !w-2 !border-foreground !bg-foreground" />

      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-foreground bg-card text-xs font-semibold">
          {entity.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{entity.name}</div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{entity.relationship}</span>
            <span>·</span>
            <span>{factCount} fact{factCount === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>
      {entity.email && (
        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{entity.email}</div>
      )}
    </div>
  );
}

function DocumentNode({ data }: NodeProps) {
  const { doc, focused } = data as DocNodeData;
  return (
    <div
      className={cn(
        "w-[220px] rounded-md border bg-card px-3 py-2 text-card-foreground shadow-sm",
        focused === false && "opacity-40",
        focused === true && "border-foreground"
      )}
    >
      <div className="flex items-center gap-1.5">
        {doc.ocrUsed ? <ScanLine className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate text-xs font-medium">{doc.name}</span>
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {doc.docType}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-foreground !bg-foreground" />
    </div>
  );
}

function FactNode({ data }: NodeProps) {
  const d = data as FactNodeData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(d.value);

  useEffect(() => { if (!editing) setDraft(d.value); }, [d.value, editing]);

  async function save() {
    if (draft.trim() === d.value.trim()) { setEditing(false); return; }
    await d.onSave(draft);
    setEditing(false);
  }

  const stateClass =
    d.conflict === "red_flag" ? "status-redflag"
    : d.conflict === "conflict" ? "status-conflict"
    : d.conflict === "stale" ? "status-stale"
    : "border";

  return (
    <div
      className={cn(
        "group w-[240px] rounded-md bg-card px-3 py-2 text-card-foreground shadow-sm",
        stateClass,
        d.focused === false && "opacity-40",
        d.focused === true && "ring-1 ring-foreground"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-foreground !bg-foreground" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[8px] font-medium">
            {d.entityInitials}
          </span>
          <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{d.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {d.sourcesCount > 1 && <Badge variant="muted">{d.sourcesCount}×</Badge>}
          {!editing && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="mt-1 flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="nodrag flex-1 rounded border border-input bg-transparent px-1.5 py-0.5 font-mono text-xs outline-none focus:border-foreground"
          />
          <button onClick={(e) => { e.stopPropagation(); void save(); }} title="Save">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setEditing(false); }} title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="block w-full truncate text-left font-mono text-xs hover:text-muted-foreground"
        >
          {d.value || "—"}
        </button>
      )}
    </div>
  );
}

function DeletableEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  const d = data as EdgeData | undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          onClick={(e) => { e.stopPropagation(); if (d?.onDelete) void d.onDelete(); }}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="nodrag nopan pointer-events-auto absolute flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-foreground opacity-0 transition-opacity hover:bg-accent hover:opacity-100 [.react-flow__edge:hover_&]:opacity-100"
          title="Remove this source"
        >
          <X className="h-3 w-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
