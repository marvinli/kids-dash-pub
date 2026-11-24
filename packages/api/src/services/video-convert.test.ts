import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { MAX_VIDEO_BYTES } from "./slide-sync";

const item = { sourceId: "v", version: "7", kind: "video" as const, sizeBytes: 9, durationMs: 1 };

describe("VideoConvertService", () => {
  it("stores the converted video by hash and records it done", async () => {
    const w = fakeWorld();
    await w.conversions.putConversion("v", "7", { state: "pending", at: "x", attempts: 2 });
    const bytes = new Uint8Array([4, 5, 6]);
    w.converter.outputs.set("v", bytes);
    await w.services.videos.convert(item);
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(w.photos.objects.get(`slides/${sha}.mp4`)?.contentType).toBe("video/mp4");
    expect(w.conversions.records.get("v#7")).toEqual({
      state: "done",
      at: w.clock.current.toISOString(),
      attempts: 2,
      sha256: sha,
      key: `slides/${sha}.mp4`,
    });
    expect(w.logger.lines.at(-1)).toMatchObject({ level: "info", message: "video converted" });
  });

  it("records a failure, including a result too big for the frame", async () => {
    const w = fakeWorld();
    w.converter.outputs.set("v", new Uint8Array(MAX_VIDEO_BYTES + 1));
    await w.services.videos.convert(item);
    expect(w.conversions.records.get("v#7")).toMatchObject({ state: "failed", attempts: 1 });
    expect(w.conversions.records.get("v#7")?.error).toMatch(/over/);
    expect(w.photos.objects.size).toBe(0);
  });
});
