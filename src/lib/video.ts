import "server-only";
import { serverEnv } from "@/lib/env.server";
import { BRAND_NAME } from "@/lib/env";

/**
 * Creates a video room for a virtual session. Jitsi needs no account (good
 * default); Daily gives private rooms with expiry when DAILY_API_KEY is set.
 */
export async function createVideoRoom(opts: { bookingId: string; endsAt: string }): Promise<string> {
  const provider = serverEnv.videoProvider();
  const key = serverEnv.dailyApiKey();
  if (provider === "daily" && key) {
    const res = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `hbs-${opts.bookingId.slice(0, 18)}`,
        privacy: "public",
        properties: {
          exp: Math.floor(new Date(opts.endsAt).getTime() / 1000) + 60 * 60,
          enable_chat: true,
          enable_screenshare: true,
        },
      }),
    });
    if (res.ok) {
      const room = (await res.json()) as { url: string };
      return room.url;
    }
    console.error("[video] Daily room creation failed", res.status, await res.text());
  }
  const slug = BRAND_NAME.replace(/[^a-z0-9]/gi, "");
  return `https://meet.jit.si/${slug}-${opts.bookingId}`;
}
