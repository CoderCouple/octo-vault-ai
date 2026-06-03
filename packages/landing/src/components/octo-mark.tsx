// Local copy of the OctoMark brand SVG. Inlined here (rather than imported
// from @octovault/ui) to keep the landing package's module graph small —
// the ui package transitively pulls in tesseract.js, pdf.js, IndexedDB
// adapters, etc., none of which a static marketing site should be paying for.

interface OctoMarkProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export function OctoMark({ className, ...props }: OctoMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="OctoVault AI"
      className={className ?? "h-5 w-5"}
      {...props}
    >
      <polygon
        points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="1.75" fill="currentColor" />
      <path d="M11 12.5 L11 16.25 L13 16.25 L13 12.5 Z" fill="currentColor" />
    </svg>
  );
}
