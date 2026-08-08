"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onGoogle() {
    setError(null);
    setBusy(true);
    try {
      // Redirect flow: this navigates away to Google and comes back through the
      // Convex callback, so on success this page unmounts rather than resolving.
      await signIn("google", { redirectTo: "/scout" });
    } catch {
      setError("Couldn't reach Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  async function onDemo() {
    setError(null);
    setBusy(true);
    try {
      // The Anonymous provider marks the user as a demo account atomically, so
      // nothing else has to succeed here. DemoBanner registers the expiry timer
      // once the session has settled — doing it inline would race the auth
      // token reaching the Convex client and leave the user stuck on this page.
      await signIn("anonymous");
      router.replace("/scout");
    } catch {
      setError("Couldn't start the demo. Please try again.");
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn("password", { email, password, flow });
      router.replace("/scout");
    } catch {
      setError(
        flow === "signUp"
          ? "Couldn't create the account — the email may be taken or the password too short (8+ characters)."
          : "Invalid email or password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[380px] pt-10">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
        {flow === "signIn" ? "Sign in to scout" : "Create an account"}
      </h1>
      <p className="mt-1 text-[13px] text-muted">
        {flow === "signIn"
          ? "Access your team's scouting workspaces."
          : "Then create a workspace or join one with a code."}
      </p>

      <button
        onClick={onGoogle}
        disabled={busy}
        className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-[#232323] bg-surface px-4 py-3 text-[15px] font-medium text-foreground transition-colors hover:border-[#3a3a3a] disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        Continue with Google
      </button>

      <div className="mt-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-[#52565e]">
        <div className="h-px flex-1 bg-[#1a1a1a]" />
        or
        <div className="h-px flex-1 bg-[#1a1a1a]" />
      </div>

      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-[#3a3a3a]"
        />
        <input
          type="password"
          required
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-[#232323] bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-[#3a3a3a]"
        />
        {error && <p className="text-[13px] text-accent">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "…" : flow === "signIn" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        onClick={() => {
          setFlow(flow === "signIn" ? "signUp" : "signIn");
          setError(null);
        }}
        className="mt-4 text-[13px] text-muted hover:text-foreground"
      >
        {flow === "signIn"
          ? "No account? Create one"
          : "Already have an account? Sign in"}
      </button>

      <div className="mt-8 border-t border-[#1a1a1a] pt-6">
        <button
          onClick={onDemo}
          disabled={busy}
          className="w-full rounded-xl border border-[#232323] px-4 py-3 text-[15px] font-medium text-foreground transition-colors hover:border-[#3a3a3a] disabled:opacity-60"
        >
          Try the demo — no sign-up
        </button>
        <p className="mt-2 text-center text-[12px] text-[#6b6f78]">
          Explore scouting with throwaway data. Everything is deleted when you
          close the tab.
        </p>
      </div>
    </div>
  );
}
