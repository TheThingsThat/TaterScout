import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";

// Three ways in:
// - Google (preferred): no password to forget/steal, and the sign-in-only
//   scopes (openid/email/profile) are uncapped + verification-free on Google's
//   side. Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the deployment env.
// - Email + password: kept alongside Google because FTC students on managed
//   school accounts can have third-party Google sign-in blocked by their
//   district admin.
// - Anonymous: backs "try the demo" — a throwaway identity whose data is wiped
//   when the session ends (see convex/demo.ts).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, Anonymous, Google],
});
