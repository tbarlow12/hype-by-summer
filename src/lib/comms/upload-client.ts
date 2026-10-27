// Browser-only: upload a File straight to Supabase Storage through a signed
// upload URL (so large videos never pass through our server), with progress.
import { requestUpload } from "@/lib/comms/chat-actions";
import { validateUpload, type CommsBucket } from "@/lib/comms/policy";

export type UploadResult = { ok: true; path: string; mime: string } | { ok: false; error: string };

export async function uploadFile(
  bucket: CommsBucket,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const contentType = file.type || "application/octet-stream";
  const check = validateUpload(bucket, { size: file.size, contentType });
  if (!check.ok) return check;

  const res = await requestUpload({ bucket, fileName: file.name, contentType, size: file.size });
  if (!res.ok) return res;
  const { signedUrl, path } = res.upload;

  return new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve({ ok: true, path, mime: contentType });
      } else {
        let message = "Upload failed. Please try again.";
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          if (xhr.status === 413 || /too large|maximum/i.test(body.message ?? "")) message = "That file is too large to upload.";
        } catch {
          /* keep default message */
        }
        resolve({ ok: false, error: message });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "Network error during upload. Check your connection and retry." });
    xhr.onabort = () => resolve({ ok: false, error: "Upload cancelled." });
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
