import { describe, expect, it } from "vitest";
import { deviceRecord, fakeWorld } from "../../test/fakes";
import { NotFoundError, RateLimitedError } from "./errors";
import { FRAME_INCIDENTS_PER_HOUR } from "./incident-service";

const KITCHEN = "4cd57a7dc2acdf5d";
const report = {
  since: "2026-11-16T11:55:58.000Z",
  until: "2026-11-16T12:41:30.000Z",
  wifi: "no-networks",
  asleep: false,
  reboot: "watchdog",
  appVersion: 67,
  log: "wpa_supplicant: CTRL-EVENT-DISCONNECTED reason=1",
};

function world() {
  const w = fakeWorld();
  w.devices.items.set(KITCHEN, deviceRecord({ id: KITCHEN, name: "Kitchen frame" }));
  return w;
}

describe("IncidentService", () => {
  it("stores a frame's outage report, names the frame and logs it", async () => {
    const w = world();
    const incident = await w.services.incidents.record(KITCHEN, report);
    expect(incident).toMatchObject({
      deviceId: KITCHEN,
      deviceName: "Kitchen frame",
      receivedAt: "2026-11-16T12:42:00.000Z",
      minutes: 45,
      wifi: "no-networks",
      reboot: "watchdog",
    });
    expect(incident.id).toMatch(/^[0-9a-f]{16}$/);
    expect(w.incidents.items).toEqual([incident]);
    expect(w.logger.lines).toContainEqual({
      level: "warn",
      message: "frame was offline",
      fields: expect.objectContaining({ deviceName: "Kitchen frame", minutes: 45, logChars: 48 }),
    });
    expect(JSON.stringify(w.logger.lines)).not.toContain("CTRL-EVENT");
  });

  it("refuses bad reports, unknown frames and floods", async () => {
    const w = world();
    await expect(
      w.services.incidents.record(KITCHEN, { ...report, wifi: "fine" }),
    ).rejects.toThrow();
    await expect(w.services.incidents.record("f".repeat(16), report)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (let i = 0; i < FRAME_INCIDENTS_PER_HOUR; i++) {
      await w.services.incidents.record(KITCHEN, report);
    }
    await expect(w.services.incidents.record(KITCHEN, report)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("lists newest first without logs, per frame and capped, and returns one with its log", async () => {
    const w = world();
    w.devices.items.set("2".repeat(16), deviceRecord({ id: "2".repeat(16), name: "Nana frame" }));
    const first = await w.services.incidents.record(KITCHEN, report);
    w.clock.current = new Date("2026-11-16T13:00:00Z");
    const second = await w.services.incidents.record("2".repeat(16), { ...report, log: null });

    const all = await w.services.incidents.list();
    expect(all.map((i) => i.id)).toEqual([second.id, first.id]);
    expect(all[1]).not.toHaveProperty("log");
    expect(all.map((i) => i.logChars)).toEqual([0, 48]);
    expect((await w.services.incidents.list({ deviceId: KITCHEN })).map((i) => i.id)).toEqual([
      first.id,
    ]);
    expect(await w.services.incidents.list({ limit: 1 })).toHaveLength(1);
    expect(await w.services.incidents.list({ limit: 0 })).toHaveLength(1);

    expect((await w.services.incidents.get(first.id)).log).toBe(report.log);
    await expect(w.services.incidents.get("0".repeat(16))).rejects.toBeInstanceOf(NotFoundError);
  });
});
