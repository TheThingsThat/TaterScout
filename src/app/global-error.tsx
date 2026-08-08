"use client";

/**
 * Last-resort boundary: catches errors thrown in the root layout itself, where
 * the normal error.tsx can't render (it lives inside that layout). Must supply
 * its own <html>/<body>. Deliberately dependency-free — no fonts, no shared
 * components — so it can't fail for the same reason the layout did.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0a",
          color: "#f4f5f7",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#9aa0aa", marginTop: 10 }}>
            TaterScout hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              border: "none",
              borderRadius: 999,
              background: "#cd0e0e",
              color: "#fff",
              padding: "12px 22px",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ color: "#52565e", fontSize: 11, marginTop: 16, fontFamily: "monospace" }}>
              ref {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
