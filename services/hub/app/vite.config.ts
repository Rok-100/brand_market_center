import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The app is served under the authenticated hub prefix, including candidate paths.
export default defineConfig({ base: "./", plugins: [react()] });
