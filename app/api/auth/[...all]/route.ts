import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";

// Mounts every Better Auth endpoint (sign-in, sign-out, admin, get-session, ...)
// at the recommended base path `/api/auth/*`. Excluded from the proxy gate.
export const { GET, POST } = toNextJsHandler(auth);
