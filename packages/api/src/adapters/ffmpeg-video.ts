import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaFolderReader, MediaItem, VideoConverter } from "../services/ports";

/** Runs a program to the end: its exit code and the tail of what it wrote to stderr. */
export type Run = (command: string, args: string[]) => Promise<{ code: number; stderr: string }>;

/** Fit inside the frame's 1920×1080 screen, never upscaled; H.264 wants even sizes. */
const FIT =
  "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
/**
 * HDR (phone HLG or PQ, BT.2020, 10-bit) to SDR BT.709: to linear light,
 * float RGB, BT.709 primaries, Hable tone curve, back to 8-bit video range.
 */
const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv";

/**
 * Converts slideshow videos with ffmpeg (a static build in a Lambda layer at
 * /opt/bin): the frame's hardware decoder takes 8-bit H.264 up to 1080p, not
 * the 10-bit HDR HEVC phones record. Muted (the frame plays videos silent),
 * at most 30 fps, bitrate capped so two minutes stay well under the size limit.
 */
export class FfmpegVideoConverter implements VideoConverter {
  constructor(
    private readonly media: Pick<MediaFolderReader, "downloadTo">,
    private readonly ffmpeg = "/opt/bin/ffmpeg",
    private readonly run: Run = runProcess,
    private readonly scratch = tmpdir(),
  ) {}

  async convert(item: MediaItem): Promise<Uint8Array> {
    const dir = await mkdtemp(join(this.scratch, "video-"));
    try {
      const input = join(dir, "original");
      const output = join(dir, "frame.mp4");
      await this.media.downloadTo(item, input);
      // With no output ffmpeg only describes the input (and exits 1).
      const probe = await this.run(this.ffmpeg, ["-hide_banner", "-nostdin", "-i", input]);
      if (!/Stream #.*Video:/.test(probe.stderr)) {
        throw new Error(`not a video: ${lastLines(probe.stderr)}`);
      }
      const result = await this.run(this.ffmpeg, ffmpegArgs(input, output, isHdr(probe.stderr)));
      if (result.code !== 0) {
        throw new Error(`ffmpeg exited ${result.code}: ${lastLines(result.stderr)}`);
      }
      return new Uint8Array(await readFile(output));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** HDR when the video stream's transfer is HLG (arib-std-b67) or PQ (smpte2084). */
export function isHdr(description: string): boolean {
  return description
    .split("\n")
    .some((line) => /Stream #.*Video:/.test(line) && /arib-std-b67|smpte2084/.test(line));
}

export function ffmpegArgs(input: string, output: string, hdr: boolean): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-vf",
    hdr ? `${FIT},${TONEMAP},format=yuv420p` : `${FIT},format=yuv420p`,
    "-fpsmax",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-maxrate",
    "4M",
    "-bufsize",
    "8M",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-movflags",
    "+faststart",
    output,
  ];
}

function lastLines(text: string): string {
  return text.trim().split("\n").slice(-3).join(" | ");
}

/** Spawns without a shell; keeps the last 16 KB of stderr (ffmpeg's progress is chatty). */
export const runProcess: Run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
