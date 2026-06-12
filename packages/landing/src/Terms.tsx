import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { OctoMark } from "./components/octo-mark";

export function TermsPage() {
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
          <FileText className="h-5 w-5" />
        </div>
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Terms and Conditions
        </p>
        <h1 className="font-serif text-[38px] leading-tight md:text-[56px]">
          OctoVault AI Terms and Conditions
        </h1>
        <p className="mt-5 max-w-[720px] text-[16px] leading-7 text-muted-foreground">
          These terms describe the basic rules for using OctoVault AI, including the
          desktop app, website, and Chrome extension.
        </p>

        <div className="mt-12 space-y-10">
          <TermsSection title="Use of OctoVault AI">
            <p>
              OctoVault AI is provided to help you organize personal documents, extract facts,
              query your local vault, and fill web forms using information you choose to store.
              You are responsible for reviewing any information before submitting a form or relying
              on an answer.
            </p>
          </TermsSection>

          <TermsSection title="Local Data and Backups">
            <p>
              OctoVault AI is designed for local-first storage. You are responsible for maintaining
              backups of your device and vault data. OctoVault AI is not responsible for data loss
              caused by device failure, accidental deletion, operating system issues, or third-party
              software.
            </p>
          </TermsSection>

          <TermsSection title="No Professional Advice">
            <p>
              OctoVault AI may help summarize documents and fill forms, but it does not provide
              legal, immigration, medical, financial, tax, or other professional advice. Always
              review source documents and consult a qualified professional when needed.
            </p>
          </TermsSection>

          <TermsSection title="Acceptable Use">
            <p>
              You agree not to use OctoVault AI to violate laws, infringe others' rights, bypass
              website protections, submit false information, or automate actions that you are not
              authorized to perform.
            </p>
          </TermsSection>

          <TermsSection title="Third-Party Websites">
            <p>
              The Chrome extension may help fill forms on third-party websites at your request.
              Those websites are governed by their own terms and privacy policies. OctoVault AI is
              not responsible for third-party websites or services.
            </p>
          </TermsSection>

          <TermsSection title="Changes">
            <p>
              These terms may be updated from time to time. Continued use of OctoVault AI after an
              update means you accept the revised terms.
            </p>
          </TermsSection>
        </div>

        <div className="mt-14 flex items-start gap-3 rounded-md border border-border bg-card p-4 text-[13px] leading-6 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <p>Last updated: June 12, 2026.</p>
        </div>
      </section>
    </main>
  );
}

function TermsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-7">
      <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-4 text-[15px] leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
