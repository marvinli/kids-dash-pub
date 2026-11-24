import { randomBytes } from "node:crypto";
import { type FrameIncident, FrameIncidentInput } from "@kids-dash/core";
import { NotFoundError, RateLimitedError } from "./errors";
import type { Clock, CounterStore, DeviceStore, IncidentStore, Logger } from "./ports";
import { activeDevice } from "./slide-folders";

/** Reports one frame may send per clock hour (a flapping frame must not fill the table). */
export const FRAME_INCIDENTS_PER_HOUR = 12;
/** What the admin list returns by default, and at most. */
export const DEFAULT_INCIDENT_LIMIT = 20;
export const MAX_INCIDENT_LIMIT = 100;

/** A report without its log, which can be long; `logChars` says how much there is. */
export type IncidentSummary = Omit<FrameIncident, "log"> & { logChars: number };

export interface IncidentServiceDeps {
  clock: Clock;
  devices: DeviceStore;
  incidents: IncidentStore;
  counters: CounterStore;
  logger: Logger;
}

/**
 * Outages frames report once they are back online: how long they could not
 * reach the API, what the Wi-Fi looked like, and whether they rebooted. Each
 * one is stored for the admin API and logged, so CloudWatch has it too.
 */
export class IncidentService {
  constructor(private readonly deps: IncidentServiceDeps) {}

  async record(deviceId: string, input: unknown): Promise<FrameIncident> {
    const report = FrameIncidentInput.parse(input);
    const device = await activeDevice(this.deps.devices, deviceId);
    const now = this.deps.clock.now();
    const hour = now.toISOString().slice(0, 13);
    const count = await this.deps.counters.increment(
      `frame-incidents#${deviceId}#${hour}`,
      new Date(now.getTime() + 2 * 3600 * 1000),
    );
    if (count > FRAME_INCIDENTS_PER_HOUR) {
      throw new RateLimitedError("Too many reports from this frame; try again later");
    }

    const incident: FrameIncident = {
      id: randomBytes(8).toString("hex"),
      deviceId,
      deviceName: device.name,
      receivedAt: now.toISOString(),
      ...report,
      minutes: Math.floor((Date.parse(report.until) - Date.parse(report.since)) / 60_000),
    };
    await this.deps.incidents.put(incident);
    const { log, ...fields } = incident;
    this.deps.logger.warn("frame was offline", { ...fields, logChars: log?.length ?? 0 });
    return incident;
  }

  /** Newest first, optionally for one frame, without logs. */
  async list(options: { deviceId?: string; limit?: number } = {}): Promise<IncidentSummary[]> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_INCIDENT_LIMIT, 1),
      MAX_INCIDENT_LIMIT,
    );
    return (await this.deps.incidents.list())
      .filter((i) => options.deviceId === undefined || i.deviceId === options.deviceId)
      .slice(0, limit)
      .map(({ log, ...rest }) => ({ ...rest, logChars: log?.length ?? 0 }));
  }

  /** One report with its log. */
  async get(id: string): Promise<FrameIncident> {
    const found = (await this.deps.incidents.list()).find((i) => i.id === id);
    if (!found) throw new NotFoundError(`No incident ${id}`);
    return found;
  }
}
