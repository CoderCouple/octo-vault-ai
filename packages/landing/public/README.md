# landing/public

Files served verbatim from the site root.

## `og-image.png` (REQUIRED for full coverage)

Twitter, Facebook, iMessage, WhatsApp, and Discord want a **raster**
Open Graph image — they won't render `og-image.svg`. The HTML
references `og-image.png` first; until someone drops a PNG here,
those platforms unfurl with title + description only (no preview
image).

To produce one:

1. Take a sharp 1200×630 screenshot of the hero / above-the-fold
   demo (with the form-fill phase visible — that's the highest-
   signal frame).
2. Or convert `og-image.svg` to PNG at the same resolution:
   ```sh
   # rsvg-convert (cleanest, brew install librsvg)
   rsvg-convert -w 1200 -h 630 og-image.svg -o og-image.png

   # Or with sips (built into macOS, less clean)
   sips -s format png --resampleHeightWidth 630 1200 og-image.svg --out og-image.png
   ```
3. Drop the result at `packages/landing/public/og-image.png` and
   deploy.

The SVG fallback (`og-image.svg`) covers Slack, LinkedIn, Notion,
and any reader that handles SVG, so it's already useful in private-
beta sharing.

## `robots.txt` / `sitemap.xml`

Standard search-engine plumbing. Update `sitemap.xml` when new
public routes ship (changelog, blog, docs).

## `favicon.svg`

The OctoMark, served at /favicon.svg.
