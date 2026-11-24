import { SLIDE_KINDS } from "@kids-dash/core";
import { z } from "zod";
import { lazyServices, type Services } from "./wiring";

/** What the sync sends: the Drive item to convert. */
const Event = z.object({
  sourceId: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(SLIDE_KINDS),
  sizeBytes: z.number().nullable(),
  durationMs: z.number().nullable(),
});

/** Invoked asynchronously by the sync: converts one slideshow video for the frame. */
export function createConvertVideoHandler(services: () => Pick<Services, "videos">) {
  return async (event: unknown): Promise<void> => {
    await services().videos.convert(Event.parse(event));
  };
}

export const handler = createConvertVideoHandler(lazyServices);
