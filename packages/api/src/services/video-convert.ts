import { createHash } from "node:crypto";
import type {
  Clock,
  Logger,
  MediaItem,
  PhotoStore,
  VideoConversionStore,
  VideoConverter,
} from "./ports";
import { CONVERTED_TYPE, MAX_VIDEO_BYTES } from "./slide-sync";

export interface VideoConvertDeps {
  clock: Clock;
  converter: VideoConverter;
  photos: PhotoStore;
  conversions: VideoConversionStore;
  logger: Logger;
}

/**
 * The background half of a slideshow video (the sync starts it): converts
 * the original for the frame, stores the result under its hash, and records
 * it as done, or as failed with the reason. The next sync puts it in the
 * slideshow.
 */
export class VideoConvertService {
  constructor(private readonly deps: VideoConvertDeps) {}

  async convert(item: MediaItem): Promise<void> {
    const { sourceId, version } = item;
    const attempts = (await this.deps.conversions.getConversion(sourceId, version))?.attempts ?? 1;
    const started = this.deps.clock.now().getTime();
    try {
      const bytes = await this.deps.converter.convert(item);
      if (bytes.length > MAX_VIDEO_BYTES) {
        throw new Error(`converted video is ${bytes.length} bytes, over ${MAX_VIDEO_BYTES}`);
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = `slides/${sha256}.mp4`;
      await this.deps.photos.put(key, bytes, CONVERTED_TYPE);
      await this.deps.conversions.putConversion(sourceId, version, {
        state: "done",
        at: this.deps.clock.now().toISOString(),
        attempts,
        sha256,
        key,
      });
      this.deps.logger.info("video converted", {
        sourceId,
        bytes: bytes.length,
        seconds: Math.round((this.deps.clock.now().getTime() - started) / 1000),
      });
    } catch (error) {
      this.deps.logger.error("video conversion failed", { sourceId, error: String(error) });
      await this.deps.conversions.putConversion(sourceId, version, {
        state: "failed",
        at: this.deps.clock.now().toISOString(),
        attempts,
        error: String(error).slice(0, 500),
      });
    }
  }
}
