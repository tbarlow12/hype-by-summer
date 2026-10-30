// App-icon artwork for a business, as plain flexbox divs for next/og's
// ImageResponse: the business logo centered on white, or a monogram of its
// name in the brand colors.
export function BrandMark({
  size,
  maskable = false,
  logoUrl,
  initials,
  background,
  foreground,
}: {
  size: number;
  maskable?: boolean;
  logoUrl?: string | null;
  initials: string;
  background: string;
  foreground: string;
}) {
  const u = size / 512;
  // Keep artwork inside the maskable safe zone (inner 80%).
  const inner = (maskable ? 0.62 : 0.74) * size;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: logoUrl ? "#ffffff" : background,
        borderRadius: maskable ? 0 : 112 * u,
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" width={inner} height={inner} style={{ objectFit: "contain", width: inner, height: inner }} />
      ) : (
        <div
          style={{
            display: "flex",
            color: foreground,
            fontSize: (initials.length > 1 ? 0.42 : 0.56) * inner * (maskable ? 1.05 : 1),
            fontWeight: 800,
            letterSpacing: -0.02 * size,
            lineHeight: 1,
          }}
        >
          {initials}
        </div>
      )}
    </div>
  );
}
