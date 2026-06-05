// Vercel Edge function — proxies DMG downloads from GitHub through our
// own domain so the browser sees a same-origin response with
// Content-Disposition: attachment and triggers a real download. Solves
// every cross-origin sharp edge we hit trying to download directly:
//   - <a download> attribute is ignored cross-origin
//   - iframe loads the binary but Chrome doesn't trigger a download
//     from iframe contexts
//   - window.location.href in some setups also stalls on GitHub's
//     redirect chain
//
// Usage from the landing page:
//   /api/download?arch=arm64   → Apple Silicon DMG
//   /api/download?arch=x64     → Intel DMG

export const config = { runtime: "edge" };

const FILES = {
  arm64: "OctoVault-0.0.1-arm64.dmg",
  x64:   "OctoVault-0.0.1.dmg",
} as const;

type Arch = keyof typeof FILES;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const archParam = url.searchParams.get("arch");
  const arch: Arch = archParam === "x64" ? "x64" : "arm64";
  const file = FILES[arch];

  const ghUrl = `https://github.com/CoderCouple/octo-vault-ai/releases/latest/download/${file}`;

  const upstream = await fetch(ghUrl, { redirect: "follow" });
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream fetch failed: ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file}"`,
      // Brief edge-cache; the upstream URL itself is short-TTL signed.
      "Cache-Control": "public, max-age=60",
    },
  });
}
