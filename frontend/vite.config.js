import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  // Privy's smart-wallet creation path (viem/permissionless internals) reaches
  // for Node's `Buffer` global, which the browser does not have. Without this
  // polyfill the call throws `ReferenceError: Buffer is not defined`, Privy
  // swallows it as "Error creating smart wallet", and `useSmartWallets()`
  // returns a null client forever — with no error surfaced in the UI. Scoped to
  // `buffer` alone deliberately; we do not need the rest of the Node globals.
  plugins: [react(), nodePolyfills({ include: ["buffer"] })],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
