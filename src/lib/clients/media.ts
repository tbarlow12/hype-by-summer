import { SUPABASE_URL } from "@/lib/env";

/** Public URL prefix for a user's own folder in the public-media bucket. */
export function publicMediaPrefix(userId: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/public-media/${userId}/`;
}

/**
 * Accept only image URLs that live in the user's own public-media folder (the
 * upload widget puts them there), so a form can't point avatars elsewhere.
 */
export function isOwnPublicMediaUrl(url: string, userId: string): boolean {
  const prefix = publicMediaPrefix(userId);
  return url.startsWith(prefix) && !url.slice(prefix.length).includes("..");
}
