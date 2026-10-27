import { parseVideoUrl } from "@/lib/training/video";
import { cn } from "@/components/ui";

/** Responsive demo-video player for YouTube, Vimeo or a direct video file. */
export function VideoEmbed({ url, title, className }: { url: string | null | undefined; title: string; className?: string }) {
  const video = parseVideoUrl(url);
  if (!video) return null;
  return (
    <div className={cn("aspect-video w-full overflow-hidden rounded-xl bg-black", className)}>
      {video.kind === "file" ? (
        <video src={video.src} controls playsInline preload="metadata" className="size-full" aria-label={title} />
      ) : (
        <iframe
          src={video.embedUrl}
          title={title}
          className="size-full"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
    </div>
  );
}
