import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "process", "stream", "util", "crypto"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@idl": path.resolve(__dirname, "../target/idl"),
      "@client": path.resolve(__dirname, "../client"),
    },
  },
  define: {
    "process.env.ANCHOR_BROWSER": JSON.stringify("true"),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-solana": ["@solana/web3.js", "@coral-xyz/anchor", "@solana/spl-token"],
          "vendor-wallets": [
            "@solana/wallet-adapter-react",
            "@solana/wallet-adapter-react-ui",
            "@solana/wallet-adapter-wallets",
          ],
          "vendor-react": ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
