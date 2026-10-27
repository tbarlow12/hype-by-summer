"use client";

// Last-resort error page (replaces the root layout, so it carries its own styles).
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#09090b",
          color: "#f4f4f5",
          textAlign: "center",
          padding: "0 16px",
        }}
      >
        <title>Something went wrong</title>
        <p style={{ color: "#fb7185", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 13 }}>
          HYPE by Summer
        </p>
        <h1 style={{ fontSize: 36, margin: "12px 0", textTransform: "uppercase" }}>We hit a snag</h1>
        <p style={{ color: "#a1a1aa", maxWidth: 420 }}>The site didn&apos;t load. Please try again in a moment.</p>
        <button
          onClick={() => retry()}
          style={{ marginTop: 24, background: "#e11d48", color: "#fff", border: 0, borderRadius: 999, padding: "12px 24px", fontWeight: 700, cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
