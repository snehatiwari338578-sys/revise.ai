import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// If you deploy to GitHub Pages at https://<user>.github.io/revise-ai/,
// uncomment the base line below and set it to "/revise-ai/".
export default defineConfig({
  plugins: [react()],
  // base: "/revise-ai/",
});
