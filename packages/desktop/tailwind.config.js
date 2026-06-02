import preset from "@octovault/ui/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    "./src/renderer/**/*.{html,ts,tsx}",
    "../ui/src/**/*.{ts,tsx}",
  ],
};
