import { SUPABASE_URL } from "@/lib/env";

/** Public URL prefix for a folder (a user id or a business id) in the public-media bucket. */
export function publicMediaPrefix(folderId: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/public-media/${folderId}/`;
}

/**
 * Accept only image URLs that live in the given public-media folder (the
 * upload widget puts them there), so a form can't point images elsewhere.
 * Folder = the user's id for avatars, the business id for logos/covers.
 */
export function isPublicMediaUrlIn(url: string, folderId: string): boolean {
  const prefix = publicMediaPrefix(folderId);
  return url.startsWith(prefix) && !url.slice(prefix.length).includes("..");
}

/** A user's own folder (avatars). */
export const isOwnPublicMediaUrl = isPublicMediaUrlIn;
