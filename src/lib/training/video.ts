export type VideoEmbed =
  | { kind: "youtube" | "vimeo"; embedUrl: string; id: string }
  | { kind: "file"; src: string };

/** Turns a YouTube / Vimeo / direct video URL into something embeddable. */
export function parseVideoUrl(raw: string | null | undefined): VideoEmbed | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return id && /^[\w-]{6,}$/.test(id) ? youtube(id) : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{6,}$/.test(v)) return youtube(v);
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
    return m ? youtube(m[1]!) : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = url.pathname.match(/(?:^|\/)(\d{6,})(?:\/|$)/);
    return m ? { kind: "vimeo", id: m[1]!, embedUrl: `https://player.vimeo.com/video/${m[1]}` } : null;
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return { kind: "file", src: url.toString() };
  return null;
}

function youtube(id: string): VideoEmbed {
  return { kind: "youtube", id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
}
