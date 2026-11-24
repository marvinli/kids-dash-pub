import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FfmpegVideoConverter, ffmpegArgs, isHdr, type Run, runProcess } from "./ffmpeg-video";

const item = { sourceId: "v1", version: "1", kind: "video" as const, sizeBytes: 3, durationMs: 1 };
const IPHONE =
  "  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 30 fps\n" +
  "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo\n";
const PIXEL = "  Stream #0:0: Video: h264 (High) (avc1), yuv420p(tv, bt709), 1920x1080, 30 fps\n";

async function converter(run: Run) {
  const scratch = await mkdtemp(join(tmpdir(), "ffmpeg-test-"));
  const media = { downloadTo: vi.fn(async (_i: unknown, path: string) => writeFile(path, "orig")) };
  return { scratch, media, c: new FfmpegVideoConverter(media, "/opt/bin/ffmpeg", run, scratch) };
}

describe("FfmpegVideoConverter", () => {
  it("downloads, describes, converts and returns the result, leaving no files", async () => {
    const run = vi.fn<Run>(async (_cmd, args) => {
      if (args.length === 4) return { code: 1, stderr: IPHONE };
      await writeFile(args.at(-1) as string, new Uint8Array([1, 2]));
      return { code: 0, stderr: "done" };
    });
    const { scratch, media, c } = await converter(run);
    expect([...(await c.convert(item))]).toEqual([1, 2]);
    expect(media.downloadTo).toHaveBeenCalledWith(item, expect.stringMatching(/original$/));
    expect(run.mock.calls[1]?.[0]).toBe("/opt/bin/ffmpeg");
    expect(run.mock.calls[1]?.[1].join(" ")).toContain("tonemap=tonemap=hable");
    expect(await readdir(scratch)).toEqual([]);
  });

  it("refuses what is not a video, and reports ffmpeg's failure", async () => {
    const notVideo = await converter(async () => ({ code: 1, stderr: "Invalid data found" }));
    await expect(notVideo.c.convert(item)).rejects.toThrow(/not a video: Invalid data/);
    expect(await readdir(notVideo.scratch)).toEqual([]);

    const broken = await converter(async (_cmd, args) =>
      args.length === 4 ? { code: 1, stderr: PIXEL } : { code: 234, stderr: "a\nb\nc\nd" },
    );
    await expect(broken.c.convert(item)).rejects.toThrow("ffmpeg exited 234: b | c | d");
  });
});

describe("ffmpeg arguments", () => {
  it("tone-maps HDR only", () => {
    expect(isHdr(IPHONE)).toBe(true);
    expect(isHdr(PIXEL)).toBe(false);
    expect(isHdr(`${PIXEL}  Stream #0:1: Audio: arib-std-b67?\n`)).toBe(false);
    const sdr = ffmpegArgs("in", "out.mp4", false);
    expect(sdr.join(" ")).not.toContain("zscale");
    expect(sdr.slice(-1)).toEqual(["out.mp4"]);
    expect(sdr).toEqual(expect.arrayContaining(["-an", "libx264", "+faststart"]));
    expect(
      ffmpegArgs("in", "out.mp4", true)[ffmpegArgs("in", "out", true).indexOf("-vf") + 1],
    ).toMatch(/^scale=.*zscale=t=linear.*format=yuv420p$/);
  });
});

describe("runProcess", () => {
  it("returns the exit code and stderr, and fails when the program is missing", async () => {
    expect(
      await runProcess(process.execPath, ["-e", "process.stderr.write('oops'); process.exit(3)"]),
    ).toEqual({ code: 3, stderr: "oops" });
    await expect(runProcess("/no/such/ffmpeg", [])).rejects.toThrow(/ENOENT/);
  });
});
