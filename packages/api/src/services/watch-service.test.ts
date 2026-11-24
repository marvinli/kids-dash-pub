import type { FrameIncident } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { deviceRecord, fakeWorld } from "../../test/fakes";
import { explain } from "./watch-service";

const KITCHEN = "4cd57a7dc2acdf5d";
const NANA = "fedcba9876543210";
// The fake clock reads 2026-11-16T12:42:00Z (07:42 in New York).
const MIN = 60_000;
const ago = (minutes: number) =>
  new Date(Date.parse("2026-11-16T12:42:00Z") - minutes * MIN).toISOString();

function world(kitchenSeen: string | null = ago(2)) {
  const w = fakeWorld();
  w.devices.items.set(
    KITCHEN,
    deviceRecord({ id: KITCHEN, name: "Kitchen frame", lastSeenAt: kitchenSeen }),
  );
  return w;
}

function incident(overrides: Partial<FrameIncident> = {}): FrameIncident {
  return {
    id: "1182031baad94429",
    deviceId: KITCHEN,
    deviceName: "Kitchen frame",
    receivedAt: "2026-11-16T12:40:00.000Z",
    since: ago(100),
    until: ago(2),
    minutes: 98,
    wifi: "no-networks",
    asleep: true,
    reboot: "watchdog",
    appVersion: 69,
    log: null,
    ...overrides,
  };
}

describe("WatchService", () => {
  it("says nothing while frames check in", async () => {
    const w = world();
    expect(await w.services.watch.run()).toEqual({ offline: [], sent: 0 });
    expect(w.notifier.sent).toEqual([]);
    expect(w.watch.puts).toBe(0);
  });

  it("emails once when a frame has been quiet for an hour", async () => {
    const w = world(ago(61));
    expect(await w.services.watch.run()).toEqual({ offline: [KITCHEN], sent: 1 });
    expect(w.notifier.sent[0]?.subject).toBe("Kitchen frame is offline");
    expect(w.notifier.sent[0]?.body).toContain("last checked in at Mon 6:41 AM (1 h 1 min ago)");
    expect(w.watch.offline).toEqual({ [KITCHEN]: ago(61) });

    w.clock.current = new Date(Date.parse("2026-11-16T12:42:00Z") + 30 * MIN);
    expect(await w.services.watch.run()).toEqual({ offline: [KITCHEN], sent: 0 });
    expect(w.notifier.sent).toHaveLength(1);
    expect(w.watch.puts).toBe(1);
  });

  it("not before the hour", async () => {
    const w = world(ago(59));
    expect((await w.services.watch.run()).sent).toBe(0);
  });

  it("emails when it is back, with what its outage report says", async () => {
    const w = world(ago(2));
    w.watch.offline = { [KITCHEN]: ago(100) };
    w.incidents.items.push(
      incident({ id: "0000000000000old", receivedAt: ago(200), reboot: "other" }),
    );
    w.incidents.items.push(incident());
    expect(await w.services.watch.run()).toEqual({ offline: [], sent: 1 });
    const mail = w.notifier.sent[0];
    expect(mail?.subject).toBe("Kitchen frame is back online");
    expect(mail?.body).toContain("offline from Mon 6:02 AM to Mon 7:40 AM (about 1 h 38 min)");
    expect(mail?.body).toContain("Wi-Fi chip had stopped working, and the watchdog restarted it");
    expect(mail?.body).toContain("1182031baad94429");
    expect(w.watch.offline).toEqual({});
    expect(w.logger.lines).toContainEqual({
      level: "info",
      message: "frame watch",
      fields: { offline: [], sent: 1 },
    });
  });

  it("says so when no report came", async () => {
    const w = world(ago(2));
    w.watch.offline = { [KITCHEN]: ago(30) };
    w.incidents.items.push(incident({ deviceId: NANA }));
    await w.services.watch.run();
    expect(w.notifier.sent[0]?.body).toContain(
      "offline from Mon 7:12 AM to Mon 7:40 AM (about 28 min)",
    );
    expect(w.notifier.sent[0]?.body).toContain("has not sent an outage report");
  });

  it("retries an email that failed, and logs the failure", async () => {
    const w = world(ago(90));
    w.notifier.error = new Error("SNS down");
    expect(await w.services.watch.run()).toEqual({ offline: [], sent: 0 });
    expect(w.logger.lines[0]).toMatchObject({ level: "error", message: "alert not sent" });

    w.notifier.error = null;
    expect((await w.services.watch.run()).sent).toBe(1);

    w.devices.items.set(
      KITCHEN,
      deviceRecord({ id: KITCHEN, name: "Kitchen frame", lastSeenAt: ago(1) }),
    );
    w.notifier.error = new Error("SNS down");
    expect(await w.services.watch.run()).toEqual({ offline: [KITCHEN], sent: 0 });
    w.notifier.error = null;
    expect(await w.services.watch.run()).toEqual({ offline: [], sent: 1 });
  });

  it("ignores agents, revoked frames and frames that never checked in, and forgets them", async () => {
    const w = world(null);
    w.devices.items.set(NANA, deviceRecord({ id: NANA, lastSeenAt: ago(500), revokedAt: ago(10) }));
    w.devices.items.set(
      "agent",
      deviceRecord({ id: "agent", role: "agent", lastSeenAt: ago(500) }),
    );
    w.watch.offline = { [NANA]: ago(600) };
    expect(await w.services.watch.run()).toEqual({ offline: [], sent: 0 });
    expect(w.watch.offline).toEqual({});
  });

  it("falls back to New York time without settings", async () => {
    const w = fakeWorld(null);
    w.devices.items.set(
      KITCHEN,
      deviceRecord({ id: KITCHEN, name: "Kitchen frame", lastSeenAt: ago(180) }),
    );
    await w.services.watch.run();
    expect(w.notifier.sent[0]?.body).toContain("at Mon 4:42 AM (3 h ago)");
  });
});

describe("explain", () => {
  it.each([
    [{ reboot: "other" }, "most likely lost power"],
    [{ reboot: "watchdog" }, "the watchdog restarted it"],
    [{ reboot: "none", wifi: "connected" }, "the internet or the router was probably down"],
    [{ reboot: "none", wifi: "no-networks" }, "recovered without a restart"],
    [{ reboot: "none", wifi: "disconnected" }, "reconnected on its own"],
    [{ reboot: "none", wifi: "unknown" }, "could not tell"],
  ] as const)("%o", (fields, words) => {
    expect(explain(incident(fields))).toContain(words);
  });

  it("mentions a dark screen", () => {
    expect(explain(incident({ asleep: true }))).toContain("screen was dark");
    expect(explain(incident({ asleep: false }))).not.toContain("screen was dark");
  });
});
