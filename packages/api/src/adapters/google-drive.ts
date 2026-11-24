import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type { SlideKind } from "@kids-dash/core";
import { z } from "zod";
import type { MediaFile, MediaFolderReader, MediaItem } from "../services/ports";
import type { GoogleAuth } from "./google-auth";

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
/** Google renders a JPEG at most this size from any image, HEIC included. */
/**
 * Longest side 1920: landscape fills the frame and a portrait stays sharp as a
 * half-screen panel. Part of a photo's version, so a change re-fetches.
 */
const PHOTO_SIZE = "=s1920";
/** Containers Android's MediaPlayer opens; anything else is skipped. */
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/3gpp", "video/webm"]);

const FileList = z.object({
  files: z
    .array(
      z.object({
        id: z.string(),
        mimeType: z.string(),
        md5Checksum: z.string().optional(),
        modifiedTime: z.string(),
        size: z.string().optional(),
        thumbnailLink: z.string().optional(),
        videoMediaMetadata: z.object({ durationMillis: z.string().optional() }).optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

/**
 * Lists and downloads photos and videos from a Drive folder shared with the
 * service account. Photos are fetched through Drive's thumbnail renderer, so
 * every format Drive previews (HEIC from phones included) arrives as a
 * frame-sized JPEG and no image library is needed here.
 */
export class GoogleDriveMediaReader implements MediaFolderReader {
  private readonly thumbnails = new Map<string, string>();

  constructor(
    private readonly auth: GoogleAuth,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async list(folderId: string, limit: number): Promise<MediaItem[]> {
    const token = await this.auth.accessToken();
    const items: MediaItem[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
        orderBy: "modifiedTime desc",
        pageSize: String(Math.min(limit, 1000)),
        fields:
          "nextPageToken,files(id,mimeType,md5Checksum,modifiedTime,size,thumbnailLink,videoMediaMetadata(durationMillis))",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      const response = await this.fetchFn(`${FILES_URL}?${params}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Google Drive list answered ${response.status}`);
      const page = FileList.parse(await response.json());
      for (const file of page.files) {
        const kind: SlideKind | null = file.mimeType.startsWith("image/")
          ? "photo"
          : VIDEO_TYPES.has(file.mimeType)
            ? "video"
            : null;
        // Photos without a rendered thumbnail (still processing) wait for a later sync.
        if (!kind || (kind === "photo" && !file.thumbnailLink)) continue;
        if (file.thumbnailLink) this.thumbnails.set(file.id, file.thumbnailLink);
        items.push({
          sourceId: file.id,
          version: `${file.md5Checksum ?? file.modifiedTime}${kind === "photo" ? PHOTO_SIZE : ""}`,
          kind,
          sizeBytes: file.size ? Number(file.size) : null,
          durationMs: file.videoMediaMetadata?.durationMillis
            ? Number(file.videoMediaMetadata.durationMillis)
            : null,
        });
        if (items.length >= limit) return items;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  async download(item: MediaItem): Promise<MediaFile> {
    const token = await this.auth.accessToken();
    const url =
      item.kind === "photo"
        ? photoUrl(this.thumbnails.get(item.sourceId))
        : `${FILES_URL}/${encodeURIComponent(item.sourceId)}?alt=media&supportsAllDrives=true`;
    const response = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Google Drive download answered ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType };
  }

  async downloadTo(item: MediaItem, path: string): Promise<void> {
    const token = await this.auth.accessToken();
    const url = `${FILES_URL}/${encodeURIComponent(item.sourceId)}?alt=media&supportsAllDrives=true`;
    const response = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok || !response.body) {
      throw new Error(`Google Drive download answered ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(path));
  }
}

/** Drive's thumbnail links end in a size like `=s220`; ask for frame size instead. */
export function photoUrl(thumbnailLink: string | undefined): string {
  if (!thumbnailLink) throw new Error("Photo has no rendered preview; list the folder first");
  return /=[a-z0-9-]+$/i.test(thumbnailLink)
    ? thumbnailLink.replace(/=[a-z0-9-]+$/i, PHOTO_SIZE)
    : `${thumbnailLink}${PHOTO_SIZE}`;
}
