import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    serverActions: {
      // Photo uploads go through the `uploadPhotosAction` Server Action as
      // multipart FormData. Next caps Server Action request bodies at 1MB by
      // default, which would reject nearly every real photo before any app
      // code runs. Sized for a full advertised batch — MAX_FILES_PER_REQUEST
      // (10) x MAX_FILE_SIZE_BYTES (15MB) = 150MB — plus headroom for the
      // multipart boundary/part-header overhead the limit also counts.
      bodySizeLimit: "160mb",
    },
  },
};

export default nextConfig;
