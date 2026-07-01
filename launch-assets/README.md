# OctoVault launch assets

Generated on June 15, 2026.

## Ready

- `video/octovault-hero-draft-60s.mp4` — silent 60-second hero draft.
- `video/octovault-form-fill-teaser-draft-20s.mp4` — silent 20-second form-fill teaser draft.
- `screenshots/octovault-graph-retina-2880x1800.png` — knowledge graph retina screenshot.
- `screenshots/octovault-chat-retina-2880x1800.png` — chat/citations retina screenshot.
- `screenshots/octovault-conflict-retina-2880x1800.png` — conflict resolution retina screenshot.

The `*-1440x900.png` files are the original capture frames used to produce the retina versions.

## Network proof

`network/octovault-netlog.json` is a Chrome netlog capture against the landing page.
Do not use it for a "0 outbound calls" claim: the marketing site intentionally loads
PostHog assets.

The "0 outbound calls" screenshot should be captured from the product runtime
(desktop app / extension pointed at local vault + Ollama), not from the public
landing page.
