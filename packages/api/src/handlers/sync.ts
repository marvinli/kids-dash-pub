import type { SyncResult } from "../services/sync-service";
import { lazyServices, type Services } from "./wiring";

/** Scheduled by EventBridge: refresh the calendar and weather snapshots. */
export function createSyncHandler(services: () => Pick<Services, "sync">) {
  return (): Promise<SyncResult> => services().sync.run();
}

export const handler = createSyncHandler(lazyServices);
