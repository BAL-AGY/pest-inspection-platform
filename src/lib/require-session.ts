import { auth } from "./auth";

/**
 * Resolves the authenticated staff session's companyId/role for protected
 * API routes and server components. Returns null when unauthenticated so
 * callers can respond 401/redirect — never throws for the common case.
 */
export async function requireSession() {
  const session = await auth();
  const user = session?.user as
    | { companyId?: string; role?: string; email?: string | null }
    | undefined;
  if (!user?.companyId) return null;
  return { companyId: user.companyId, role: user.role ?? "staff", email: user.email };
}
