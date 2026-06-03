// PostHog wrapper for the landing site only. The product (desktop / extension)
// stays telemetry-free by policy — see Section #5 of Landing.tsx.
//
// Env vars (set in Vercel project settings):
//   VITE_POSTHOG_KEY   — project key from posthog.com (required to enable)
//   VITE_POSTHOG_HOST  — defaults to https://us.i.posthog.com (EU users: https://eu.i.posthog.com)
//
// Without VITE_POSTHOG_KEY, this module is a no-op — safe for local dev and
// for any deployment that doesn't want analytics.

import posthog from "posthog-js";

const key  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined;
const host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  if (!key) {
    if (import.meta.env.DEV) {
      console.info("[analytics] VITE_POSTHOG_KEY not set — analytics disabled");
    }
    return;
  }
  posthog.init(key, {
    api_host: host,
    // Pageviews + leaves give time-on-page in addition to the visit itself.
    capture_pageview: true,
    capture_pageleave: true,
    // Autocapture catches every click, input, and form submit and labels them
    // by tag / class / data-attr. The data-ph-capture-attribute-* and
    // data-attr hooks on important CTAs in Landing.tsx give those events
    // readable names in the dashboard.
    autocapture: true,
    // Session recording + heatmaps. Toolbar/heatmap is computed server-side
    // from the autocapture stream, so no extra config needed.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,                 // mask the waitlist email by default
      maskTextSelector: "[data-private]",  // opt-in mask for anything else
    },
    persistence: "localStorage+cookie",
    person_profiles: "identified_only",    // anonymous-first; only create profiles when we call identify()
  });
  initialized = true;
}

/** Fire a custom event. No-op when PostHog isn't initialised. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, props);
}

/** Tag a known user (e.g. after waitlist signup). */
export function identify(distinctId: string, props?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.identify(distinctId, props);
}
