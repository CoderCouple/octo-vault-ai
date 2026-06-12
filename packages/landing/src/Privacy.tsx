import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { OctoMark } from "./components/octo-mark";

export function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[860px] items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <OctoMark className="h-5 w-5" /> OctoVault AI
          </a>
          <a
            href="/"
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </a>
        </div>
      </header>

      <section className="mx-auto max-w-[860px] px-6 py-16 md:py-24">
        <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Privacy Policy
        </p>
        <h1 className="font-serif text-[38px] leading-tight md:text-[56px]">
          OctoVault AI Privacy Policy
        </h1>
        <p className="mt-5 max-w-[720px] text-[16px] leading-7 text-muted-foreground">
          OctoVault AI is designed as a local-first paperwork vault and form-filling assistant.
          Your documents, extracted facts, and form-fill data are processed for the product's
          single purpose: helping you understand your private documents and fill web forms using
          information you choose to keep in your vault.
        </p>

        <div className="mt-12 space-y-10">
          <PolicySection title="Information OctoVault AI Processes">
            <p>
              OctoVault AI may process personal information that you add to your vault, including
              names, email addresses, phone numbers, addresses, identification numbers, passport
              details, employment details, and similar facts found in your documents.
            </p>
            <p>
              The Chrome extension may also read the visible form fields, labels, options, and page
              content on the web page where you choose to use form filling. This is used to match
              page fields to facts in your vault.
            </p>
          </PolicySection>

          <PolicySection title="How Information Is Used">
            <p>
              Information is used to extract facts from documents, build your local personal
              knowledge graph, answer your questions, and fill web forms when you request it.
              OctoVault AI does not use your data for advertising, creditworthiness, lending, or
              unrelated purposes.
            </p>
          </PolicySection>

          <PolicySection title="Local-First Storage">
            <p>
              OctoVault AI is built to keep your vault on your device. The desktop app stores vault
              data locally, and the browser extension connects to the local desktop vault when
              available. If the desktop vault is unavailable, the extension may use encrypted
              browser-local storage as a fallback.
            </p>
          </PolicySection>

          <PolicySection title="Data Sharing">
            <p>
              OctoVault AI does not sell user data. OctoVault AI does not transfer user data to
              third parties except as necessary for approved uses such as providing the requested
              functionality, complying with law, or protecting users from abuse.
            </p>
          </PolicySection>

          <PolicySection title="Chrome Extension Permissions">
            <p>
              The extension requests permissions needed to detect and fill forms on pages where you
              use it, show a side panel for review, and store extension settings or encrypted local
              fallback vault data.
            </p>
          </PolicySection>

          <PolicySection title="Contact">
            <p>
              Questions or requests can be sent through the project issue tracker or the bug report
              form linked on the OctoVault AI website.
            </p>
          </PolicySection>
        </div>

        <div className="mt-14 flex items-start gap-3 rounded-md border border-border bg-card p-4 text-[13px] leading-6 text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <p>
            Last updated: June 12, 2026. This policy applies to the OctoVault AI website,
            desktop app, and Chrome extension.
          </p>
        </div>
      </section>
    </main>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-7">
      <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-4 text-[15px] leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
