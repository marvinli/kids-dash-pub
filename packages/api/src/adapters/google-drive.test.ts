import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GoogleAuth } from "./google-auth";
import { GoogleDriveMediaReader, photoUrl } from "./google-drive";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A reader whose token is already cached, so fetches are only Drive's. */
function drive(fetchFn: typeof fetch) {
  const auth = { accessToken: async () => "tok" } as unknown as GoogleAuth;
  return new GoogleDriveMediaReader(auth, fetchFn);
}

const FILES = [
  {
    id: "p1",
    mimeType: "image/heic",
    md5Checksum: "aaa",
    modifiedTime: "2026-11-15T10:00:00Z",
    size: "3000000",
    thumbnailLink: "https://lh3.googleusercontent.com/drive-storage/x=s220",
  },
  { id: "pending", mimeType: "image/jpeg", modifiedTime: "2026-11-15T09:00:00Z" },
  {
    id: "v1",
    mimeType: "video/quicktime",
    md5Checksum: "bbb",
    modifiedTime: "2026-11-14T10:00:00Z",
    size: "12000000",
    videoMediaMetadata: { durationMillis: "15000" },
  },
  { id: "avi", mimeType: "video/x-msvideo", modifiedTime: "2026-11-13T10:00:00Z", size: "1" },
];

describe("GoogleDriveMediaReader", () => {
  it("lists the folder's photos and playable videos, newest first", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      reply({ files: FILES }),
    );
    const items = await drive(fetchFn).list("folder123", 100);
    expect(items).toEqual([
      { sourceId: "p1", version: "aaa=s1920", kind: "photo", sizeBytes: 3000000, durationMs: null },
      { sourceId: "v1", version: "bbb", kind: "video", sizeBytes: 12000000, durationMs: 15000 },
    ]);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.searchParams.get("q")).toContain("'folder123' in parents and trashed = false");
    expect(url.searchParams.get("orderBy")).toBe("modifiedTime desc");
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: "Bearer tok" } });
  });

  it("stops at the limit and follows pages", async () => {
    const page = (id: string, next?: string) => ({
      files: [{ id, mimeType: "video/mp4", modifiedTime: "t", size: "1" }],
      ...(next ? { nextPageToken: next } : {}),
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(reply(page("a", "n2")))
      .mockResolvedValueOnce(reply(page("b", "n3")));
    const items = await drive(fetchFn).list("f", 2);
    expect(items.map((i) => [i.sourceId, i.version])).toEqual([
      ["a", "t"],
      ["b", "t"],
    ]);
    expect(new URL(String(fetchFn.mock.calls[1]?.[0])).searchParams.get("pageToken")).toBe("n2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("downloads photos as frame-sized renders and videos as uploaded", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("drive/v3/files?")
        ? reply({ files: FILES })
        : new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "content-type": String(url).includes("alt=media")
                ? "video/quicktime"
                : "image/jpeg; charset=binary",
            },
          }),
    );
    const reader = drive(fetchFn);
    const [photo, video] = await reader.list("f", 10);
    if (!photo || !video) throw new Error("missing items");

    const p = await reader.download(photo);
    expect(p).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe(
      "https://lh3.googleusercontent.com/drive-storage/x=s1920",
    );
    expect((await reader.download(video)).contentType).toBe("video/quicktime");
    expect(String(fetchFn.mock.calls[2]?.[0])).toBe(
      "https://www.googleapis.com/drive/v3/files/v1?alt=media&supportsAllDrives=true",
    );
  });

  it("surfaces Drive errors", async () => {
    await expect(drive(vi.fn(async () => reply({}, 404))).list("f", 1)).rejects.toThrow(/404/);
    const reader = drive(vi.fn(async () => reply({}, 403)));
    await expect(
      reader.download({ sourceId: "v", version: "1", kind: "video", sizeBytes: 1, durationMs: 1 }),
    ).rejects.toThrow(/403/);
    await expect(
      reader.download({
        sourceId: "x",
        version: "1",
        kind: "photo",
        sizeBytes: 1,
        durationMs: null,
      }),
    ).rejects.toThrow(/no rendered preview/);
  });
});

describe("GoogleDriveMediaReader.downloadTo", () => {
  const item = {
    sourceId: "v1",
    version: "1",
    kind: "video" as const,
    sizeBytes: 3,
    durationMs: 1,
  };

  it("streams the original to a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "drive-"));
    try {
      const fetchFn = vi.fn(
        async (_url: string | URL | Request) => new Response(new Uint8Array([7, 8, 9])),
      );
      const path = join(dir, "original");
      await drive(fetchFn).downloadTo(item, path);
      expect([...(await readFile(path))]).toEqual([7, 8, 9]);
      expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
        "https://www.googleapis.com/drive/v3/files/v1?alt=media&supportsAllDrives=true",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces Drive errors", async () => {
    await expect(
      drive(vi.fn(async () => reply({}, 404))).downloadTo(item, "/nope"),
    ).rejects.toThrow(/404/);
  });
});

describe("photoUrl", () => {
  it("asks Drive's renderer for the frame's size", () => {
    expect(photoUrl("https://lh3/x=s220")).toBe("https://lh3/x=s1920");
    expect(photoUrl("https://lh3/x")).toBe("https://lh3/x=s1920");
  });
});
