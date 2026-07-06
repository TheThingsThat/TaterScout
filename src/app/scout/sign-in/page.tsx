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

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
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
    </div>
  );
}
