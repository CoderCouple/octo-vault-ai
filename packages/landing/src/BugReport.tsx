// Bug-report page — /bug-report
// Same Supabase pattern as the waitlist CTA: direct REST + Storage fetch,
// no SDK dependency. Falls back gracefully when VITE_SUPABASE_* are unset.
//
// Required Supabase setup (one-time):
//   1. CREATE TABLE bug_reports (
//        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//        created_at timestamptz DEFAULT now(),
//        title text NOT NULL,
//        description text NOT NULL,
//        steps text,
//        expected text,
//        actual text,
//        email text,
//        screenshot_urls text[],
//        user_agent text,
//        app_version text
//      );
//      ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
//      CREATE POLICY "insert only" ON bug_reports FOR INSERT WITH CHECK (true);
//
//      If the table already exists without expected/actual:
//        ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS expected text;
//        ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS actual   text;
//
//   2. Create a Storage bucket named "bug-screenshots" (public read, anon insert).

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import {
  AlertTriangle, ArrowLeft, Check, Github, ImagePlus, Loader2, Trash2, X,
} from "lucide-react";
import { OctoMark } from "./components/octo-mark";
import { track } from "./analytics";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const GITHUB_ISSUES = "https://github.com/CoderCouple/octo-vault-ai/issues/new";

// ──────────────────────────────────────────────────────────────────────────────

interface ImageFile {
  id: string;
  file: File;
  preview: string;
}

type Status = "idle" | "submitting" | "ok" | "error";

// ──────────────────────────────────────────────────────────────────────────────

export function BugReportPage() {
  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      <BugNav />
      <BugForm />
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function BugNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[860px] items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <OctoMark className="h-5 w-5" /> OctoVault AI
        </a>
        <a
          href="/"
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </a>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function BugForm() {
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [steps,       setSteps]       = useState("");
  const [expected,    setExpected]    = useState("");
  const [actual,      setActual]      = useState("");
  const [email,       setEmail]       = useState("");
  const [images,      setImages]      = useState<ImageFile[]>([]);
  const [dragOver,    setDragOver]    = useState(false);
  const [status,      setStatus]      = useState<Status>("idle");
  const [errorMsg,    setErrorMsg]    = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => images.forEach((img) => URL.revokeObjectURL(img.preview));
  }, [images]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 5 - images.length);
    const next: ImageFile[] = accepted.map((f) => ({
      id: `${f.name}-${f.size}`,
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setImages((prev) => [...prev, ...next]);
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  async function uploadScreenshots(): Promise<string[]> {
    if (!SUPABASE_URL || !SUPABASE_KEY || images.length === 0) return [];
    const urls: string[] = [];
    for (const img of images) {
      const ext  = img.file.name.split(".").pop() ?? "png";
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      try {
        const res = await fetch(
          `${SUPABASE_URL}/storage/v1/object/bug-screenshots/${name}`,
          {
            method: "POST",
            headers: {
              apikey:        SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": img.file.type,
            },
            body: img.file,
          },
        );
        if (res.ok) {
          urls.push(`${SUPABASE_URL}/storage/v1/object/public/bug-screenshots/${name}`);
        }
      } catch { /* non-fatal — proceed without this image */ }
    }
    return urls;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setStatus("submitting");
    setErrorMsg("");

    try {
      const screenshotUrls = await uploadScreenshots();

      if (SUPABASE_URL && SUPABASE_KEY) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/bug_reports`, {
          method: "POST",
          headers: {
            apikey:         SUPABASE_KEY,
            Authorization:  `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer:         "return=minimal",
          },
          body: JSON.stringify({
            title:           title.trim(),
            description:     description.trim(),
            steps:           steps.trim() || null,
            expected:        expected.trim() || null,
            actual:          actual.trim() || null,
            email:           email.trim() || null,
            screenshot_urls: screenshotUrls.length ? screenshotUrls : null,
            user_agent:      navigator.userAgent,
          }),
        });
        if (!res.ok && res.status !== 201) throw new Error(await res.text());
      }

      // Single event so PostHog counts match Supabase rows 1:1. When
      // Supabase isn't configured the description payload rides along
      // so the report is at least recoverable from PostHog.
      track("bug_report_submitted", {
        title:           title.trim(),
        description:     SUPABASE_URL ? undefined : description.trim(),
        has_email:       Boolean(email.trim()),
        has_screenshots: screenshotUrls.length > 0,
        destination:     SUPABASE_URL ? "supabase" : "posthog_only",
      });

      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error. Try the GitHub link below.");
    }
  }

  // GitHub new-issue URL with text pre-filled (images can be dragged in by user).
  function githubUrl() {
    const body = [
      description.trim(),
      steps.trim()    ? `\n\n**Steps to reproduce**\n${steps.trim()}` : "",
      expected.trim() ? `\n\n**Expected**\n${expected.trim()}`        : "",
      actual.trim()   ? `\n\n**Actual**\n${actual.trim()}`            : "",
    ].join("");
    return `${GITHUB_ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=bug`;
  }

  if (status === "ok") {
    return (
      <div className="mx-auto flex max-w-[860px] flex-col items-center px-6 py-24 text-center md:py-32">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card">
          <Check className="h-6 w-6" />
        </div>
        <h1 className="font-serif text-[32px] font-medium leading-tight md:text-[48px]">
          Report received.
        </h1>
        <p className="mt-4 max-w-[440px] text-[15px] text-muted-foreground">
          Thanks — we'll look into it. If you left an email we'll follow up directly.
        </p>
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <a
            href="/"
            className="rounded-md bg-foreground px-4 py-2 text-[13px] font-semibold text-background hover:bg-foreground/90 transition-colors"
          >
            Back to home
          </a>
          <a
            href={githubUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            Also open GitHub issue
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] px-6 py-16 md:py-24">
      {/* Page header */}
      <div className="mb-12">
        <div className="mb-3 flex items-center gap-2 text-[12px] uppercase tracking-wider text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          Bug report
        </div>
        <h1 className="font-serif text-[36px] font-medium leading-tight md:text-[52px]">
          Found something <span className="italic">broken?</span>
        </h1>
        <p className="mt-4 max-w-[520px] text-[15px] text-muted-foreground">
          Describe what went wrong and attach a screenshot if you have one. We read every report.
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-8">
        {/* Title */}
        <Field label="Title" required hint="One-line summary of the bug">
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Passport expiry date shows wrong year"
            className={inputCls}
          />
        </Field>

        {/* Description */}
        <Field label="What happened?" required hint="Describe the issue in as much detail as you like">
          <textarea
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="I was trying to…"
            className={`${inputCls} resize-none`}
          />
        </Field>

        {/* Steps */}
        <Field label="Steps to reproduce" hint="Numbered steps that reliably trigger the bug">
          <textarea
            rows={3}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={"1. Open vault\n2. Click on document\n3. …"}
            className={`${inputCls} resize-none font-mono text-[13px]`}
          />
        </Field>

        {/* Expected / Actual — two columns on desktop */}
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Expected behavior" hint="What should have happened">
            <textarea
              rows={3}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="The correct expiry date should appear."
              className={`${inputCls} resize-none`}
            />
          </Field>
          <Field label="Actual behavior" hint="What actually happened">
            <textarea
              rows={3}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder="The year is off by one."
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>

        {/* Screenshot upload */}
        <Field label="Screenshots" hint="Up to 5 images (PNG, JPG, GIF, WebP)">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-colors ${
              dragOver ? "border-foreground bg-accent/50" : "border-border hover:border-foreground/40 hover:bg-accent/20"
            } ${images.length >= 5 ? "pointer-events-none opacity-50" : ""}`}
          >
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">
              {images.length >= 5 ? "Max 5 images" : "Drag & drop or click to upload"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)}
            />
          </div>

          {images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {images.map((img) => (
                <div key={img.id} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border">
                  <img src={img.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>

        {/* Email */}
        <Field label="Your email" hint="Optional — only used to follow up on this specific report">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            data-private
            className={inputCls}
          />
        </Field>

        {/* Error banner */}
        {status === "error" && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
            <X className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg || "Something went wrong."}</span>
          </div>
        )}

        {/* Submit row */}
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={status === "submitting" || !title.trim() || !description.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50 transition-opacity"
          >
            {status === "submitting" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {status === "submitting" ? "Sending…" : "Submit report"}
          </button>
          <a
            href={githubUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            Open as GitHub issue instead
          </a>
        </div>
      </form>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-[14px] shadow-sm " +
  "placeholder:text-muted-foreground/50 " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:opacity-60";

function Field({
  label, required, hint, children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1.5">
        <label className="text-[13px] font-medium">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
