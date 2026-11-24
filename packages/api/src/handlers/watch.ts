import type { WatchResult } from "../services/watch-service";
import { lazyServices, type Services } from "./wiring";

/** Scheduled by EventBridge: email when a frame goes offline or comes back. */
export function createWatchHandler(services: () => Pick<Services, "watch">) {
  return (): Promise<WatchResult> => services().watch.run();
}

export const handler = createWatchHandler(lazyServices);
