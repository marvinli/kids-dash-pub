import type { FrameIncident } from "@kids-dash/core";
import type {
  Clock,
  DeviceRecord,
  DeviceStore,
  FrameWatchStore,
  IncidentStore,
  Logger,
  Notifier,
  SettingsStore,
} from "./ports";

/** A frame that has not checked in for this long is offline (lastSeenAt is ~10 min coarse). */
export const OFFLINE_AFTER_MS = 60 * 60_000;
const FALLBACK_TIMEZONE = "America/New_York";

export interface WatchServiceDeps {
  clock: Clock;
  settings: SettingsStore;
  devices: DeviceStore;
  incidents: IncidentStore;
  watch: FrameWatchStore;
  notifier: Notifier;
  logger: Logger;
}

export interface WatchResult {
  /** Frames currently counted as offline. */
  offline: string[];
  /** Emails sent this run. */
  sent: number;
}

/**
 * Runs on a schedule: emails once when a frame goes quiet for an hour, and
 * once when it is back, with what its outage report says happened. A frame
 * that has never checked in, or is revoked, is not watched. A failed email
 * is retried on the next run.
 */
export class WatchService {
  constructor(private readonly deps: WatchServiceDeps) {}

  async run(): Promise<WatchResult> {
    const now = this.deps.clock.now().getTime();
    const timezone = (await this.deps.settings.get())?.timezone ?? FALLBACK_TIMEZONE;
    const frames = (await this.deps.devices.list()).filter(
      (d): d is DeviceRecord & { lastSeenAt: string } =>
        d.role === "device" && d.revokedAt === null && d.lastSeenAt !== null,
    );
    const before = await this.deps.watch.get();
    const after: Record<string, string> = {};
    let sent = 0;

    for (const frame of frames) {
      const alerted = before[frame.id];
      const quiet = now - Date.parse(frame.lastSeenAt) >= OFFLINE_AFTER_MS;
      if (quiet && alerted !== undefined) {
        after[frame.id] = alerted;
      } else if (quiet) {
        const minutes = Math.floor((now - Date.parse(frame.lastSeenAt)) / 60_000);
        const ok = await this.send(
          `${frame.name} is offline`,
          offlineBody(frame.name, clockTime(frame.lastSeenAt, timezone), minutes),
        );
        if (ok) {
          after[frame.id] = frame.lastSeenAt;
          sent++;
        }
      } else if (alerted !== undefined) {
        const incident = (await this.deps.incidents.list()).find(
          (i) => i.deviceId === frame.id && i.receivedAt >= alerted,
        );
        const ok = await this.send(
          `${frame.name} is back online`,
          backBody(frame.name, alerted, frame.lastSeenAt, timezone, incident),
        );
        if (ok) sent++;
        else after[frame.id] = alerted;
      }
    }

    if (!sameKeys(before, after)) await this.deps.watch.put(after);
    const offline = Object.keys(after);
    if (sent > 0) this.deps.logger.info("frame watch", { offline, sent });
    return { offline, sent };
  }

  private async send(subject: string, body: string): Promise<boolean> {
    try {
      await this.deps.notifier.send(subject, body);
      return true;
    } catch (error) {
      this.deps.logger.error("alert not sent", { subject, error: String(error) });
      return false;
    }
  }
}

function offlineBody(name: string, lastSeen: string, minutes: number): string {
  return [
    `${name} last checked in at ${lastSeen} (${duration(minutes)} ago).`,
    "",
    "If it is unplugged or switched off, there is nothing to do.",
    "If its screen is on or dark, tap it: if its Wi-Fi has died, the watchdog restarts it within a couple of minutes.",
    "",
    "You will get another email when it is back.",
  ].join("\n");
}

function backBody(
  name: string,
  since: string,
  until: string,
  timezone: string,
  incident: FrameIncident | undefined,
): string {
  const minutes = Math.max(0, Math.floor((Date.parse(until) - Date.parse(since)) / 60_000));
  return [
    `${name} was offline from ${clockTime(since, timezone)} to ${clockTime(until, timezone)} (about ${duration(minutes)}).`,
    "",
    incident ? explain(incident) : "It has not sent an outage report.",
  ].join("\n");
}

/** What an outage report says happened, in plain words. */
export function explain(incident: FrameIncident): string {
  const cause =
    incident.reboot === "other"
      ? "It restarted during the outage, so it most likely lost power (unplugged or switched off)."
      : incident.reboot === "watchdog"
        ? "Its Wi-Fi chip had stopped working, and the watchdog restarted it."
        : incident.wifi === "connected"
          ? "It stayed connected to Wi-Fi throughout, so the internet or the router was probably down."
          : incident.wifi === "no-networks"
            ? "Its Wi-Fi chip had stopped working (no networks visible); it recovered without a restart."
            : incident.wifi === "disconnected"
              ? "It was off Wi-Fi (networks were visible, but it had not joined one) and reconnected on its own."
              : "It could not tell what its Wi-Fi was doing.";
  const dark = incident.asleep ? " Its screen was dark when it went offline." : "";
  return `${cause}${dark}\n\nOutage report ${incident.id} (list_incidents / get_incident).`;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function clockTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function sameKeys(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  return ak.length === Object.keys(b).length && ak.every((k) => b[k] === a[k]);
}
