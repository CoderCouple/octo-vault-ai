// One-off: render the OctoMark SVG to PNG icons for the extension toolbar.
// Run: node scripts/generate-icons.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

// OctoMark SVG — keep in sync with packages/ui/src/components/octo-mark.tsx.
// We render on a dark-but-padded background so the icon reads well in both
// light and dark toolbar themes.
function svg(size) {
  const pad = Math.round(size * 0.12);
  const stroke = Math.max(1.5, size / 16);
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#0a0a0a"/>
  <g transform="translate(${pad}, ${pad}) scale(${inner / 24})">
    <polygon points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
             fill="none" stroke="#f5f5f5" stroke-width="${stroke}" stroke-linejoin="round"/>
    <circle cx="12" cy="11" r="1.75" fill="#f5f5f5"/>
    <path d="M11 12.5 L11 16.25 L13 16.25 L13 12.5 Z" fill="#f5f5f5"/>
  </g>
</svg>`;
}

const SIZES = [16, 32, 48, 128, 256];
for (const size of SIZES) {
  const png = new Resvg(svg(size), { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`✓ icon-${size}.png`);
}

// Also a transparent variant used by the in-page floating Fill button.
// White-on-transparent so the button can host any background color.
function svgTransparent(size) {
  const stroke = Math.max(1.5, size / 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <polygon points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
           fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linejoin="round"/>
  <circle cx="12" cy="11" r="1.75" fill="currentColor"/>
  <path d="M11 12.5 L11 16.25 L13 16.25 L13 12.5 Z" fill="currentColor"/>
</svg>`;
}
writeFileSync(join(outDir, "octo-mark.svg"), svgTransparent(24));
console.log("✓ octo-mark.svg");
