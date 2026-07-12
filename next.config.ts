import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // `sodium-native` (src/backup/crypto.ts, U1) ships a native `.node` addon
  // loaded via `node-gyp-build`'s runtime path resolution. Turbopack's build
  // tracing otherwise bundles/relocates `binding.js` into `.next/server/chunks`,
  // which breaks that relative-path resolution and fails page-data collection
  // for every route that imports it (`ADDON_NOT_FOUND`) — both backup API
  // routes, transitively. Excluding it from bundling keeps it a normal
  // `require()` resolved from `node_modules` at runtime instead.
  serverExternalPackages: ["sodium-native"],
  experimental: {
    serverActions: {
      // Photo AND document uploads go through Server Actions as multipart
      // FormData. Next caps Server Action request bodies at 1MB by default,
      // which would reject nearly every real upload before any app code runs.
      // Sized for the larger of the two advertised batches — documents:
      // MAX_FILES_PER_REQUEST (10) x MAX_FILE_SIZE_BYTES (25MB) = 250MB — plus
      // headroom for the multipart boundary/part-header overhead the limit also
      // counts. (Photos are the smaller 10 x 15MB = 150MB batch.)
      bodySizeLimit: "270mb",
    },
  },
};

export default nextConfig;
