// App-icon artwork (an "H" monogram on brand rose) as plain flexbox divs so it
// renders in next/og's ImageResponse without loading a font.
export function BrandMark({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const u = size / 512;
  const s = maskable ? 0.82 : 1; // keep the glyph inside the maskable safe zone
  const bar = { position: "absolute" as const, background: "#ffffff", borderRadius: 16 * u * s };
  const w = 212 * u * s;
  const h = 256 * u * s;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#e11d48",
        borderRadius: maskable ? 0 : 112 * u,
      }}
    >
      <div style={{ position: "relative", width: w, height: h, display: "flex" }}>
        <div style={{ ...bar, left: 0, top: 0, width: 64 * u * s, height: h }} />
        <div style={{ ...bar, right: 0, top: 0, width: 64 * u * s, height: h }} />
        <div style={{ ...bar, left: 0, top: 98 * u * s, width: w, height: 60 * u * s }} />
      </div>
    </div>
  );
}
