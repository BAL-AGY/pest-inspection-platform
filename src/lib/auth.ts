import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { assertProductionEnvironment } from "./environment";

const {
  handlers,
  auth: nextAuthAuth,
  signIn: nextAuthSignIn,
  signOut: nextAuthSignOut,
} = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          companyId: user.companyId,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.companyId = (user as { companyId: string }).companyId;
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { companyId?: string; role?: string }).companyId =
          token.companyId as string;
        (session.user as typeof session.user & { companyId?: string; role?: string }).role =
          token.role as string;
      }
      return session;
    },
  },
});

// Runtime defense in depth for code paths that load Auth.js without the
// Next.js instrumentation hook (custom servers, scripts, or changed
// hosting). Deferred to first actual call rather than module import time:
// `next build` imports this module (via dashboard pages -> requireSession)
// while collecting page data, and NODE_ENV is forced to "production" for
// that step regardless of deployment target, which would otherwise throw
// during every staging/CI build.
export { handlers };

// Narrowed to the zero-argument overload: every call site in this
// repository resolves the session this way (`await auth()`), and
// NextAuth's other overloads (middleware, API-route wrapping) aren't used.
export async function auth() {
  assertProductionEnvironment();
  return nextAuthAuth();
}

export const signIn: typeof nextAuthSignIn = (...args: Parameters<typeof nextAuthSignIn>) => {
  assertProductionEnvironment();
  return nextAuthSignIn(...args);
};

export const signOut: typeof nextAuthSignOut = (...args: Parameters<typeof nextAuthSignOut>) => {
  assertProductionEnvironment();
  return nextAuthSignOut(...args);
};
