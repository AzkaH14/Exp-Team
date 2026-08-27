"use client";

import { getErrorMessage } from "@/lib/error-message";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = getErrorMessage(error);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ maxWidth: "28rem", fontSize: "0.875rem", color: "#64748b" }}>
            {message}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
