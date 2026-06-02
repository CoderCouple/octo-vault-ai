import preset from "@octovault/ui/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    "./src/**/*.{html,ts,tsx}",
    "../ui/src/**/*.{ts,tsx}",
  ],
};
