import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { NotFoundError } from "./errors";

describe("DeviceService", () => {
  it("registers a device and never stores its secret", async () => {
    const w = fakeWorld();
    const { device, token } = await w.services.devices.register({ name: "Kitchen frame" });
    expect(token).toMatch(/^[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(device).toEqual({
      id: token.split(".")[0],
      name: "Kitchen frame",
      role: "device",
      createdAt: "2026-11-16T12:42:00.000Z",
      lastSeenAt: null,
      revokedAt: null,
      settings: { slideshowFolderId: null, greetingName: null },
      appVersion: null,
      appVersionAt: null,
    });
    const stored = JSON.stringify([...w.devices.items.values()]);
    expect(stored).not.toContain(token.split(".")[1]);
    expect(await w.services.devices.list()).toEqual([device]);
  });

  it("authenticates valid tokens, with or without the Bearer prefix", async () => {
    const w = fakeWorld();
    const { device, token } = await w.services.devices.register({ name: "Frame" });
    const who = { id: device.id, role: "device" };
    expect(await w.services.devices.authenticate(token)).toEqual(who);
    expect(await w.services.devices.authenticate(`Bearer ${token}`)).toEqual(who);
  });

  it("registers agents with their own role", async () => {
    const w = fakeWorld();
    const { device, token } = await w.services.devices.register({ name: "Duet", role: "agent" });
    expect(device.role).toBe("agent");
    expect(await w.services.devices.authenticate(token)).toEqual({ id: device.id, role: "agent" });
    await expect(w.services.devices.register({ name: "x", role: "admin" })).rejects.toThrow();
  });

  it("rejects wrong secrets, unknown ids, garbage and revoked devices", async () => {
    const w = fakeWorld();
    const { device, token } = await w.services.devices.register({ name: "Frame" });
    const [id] = token.split(".");
    expect(await w.services.devices.authenticate(`${id}.${"A".repeat(43)}`)).toBeNull();
    expect(await w.services.devices.authenticate(`${"0".repeat(16)}.${"A".repeat(43)}`)).toBeNull();
    expect(await w.services.devices.authenticate("nope")).toBeNull();
    expect(await w.services.devices.authenticate(undefined)).toBeNull();

    const revoked = await w.services.devices.revoke(device.id);
    expect(revoked.revokedAt).toBe("2026-11-16T12:42:00.000Z");
    expect(await w.services.devices.authenticate(token)).toBeNull();
    expect(await w.services.devices.revoke(device.id)).toEqual(revoked);
    await expect(w.services.devices.revoke("0".repeat(16))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records lastSeenAt at most every ten minutes", async () => {
    const w = fakeWorld();
    const { device, token } = await w.services.devices.register({ name: "Frame" });
    await w.services.devices.authenticate(token);
    expect(w.devices.items.get(device.id)?.lastSeenAt).toBe("2026-11-16T12:42:00.000Z");
    w.clock.current = new Date("2026-11-16T12:45:00Z");
    await w.services.devices.authenticate(token);
    expect(w.devices.items.get(device.id)?.lastSeenAt).toBe("2026-11-16T12:42:00.000Z");
    w.clock.current = new Date("2026-11-16T12:53:00Z");
    await w.services.devices.authenticate(token);
    expect(w.devices.items.get(device.id)?.lastSeenAt).toBe("2026-11-16T12:53:00.000Z");
  });

  it("updates a frame's settings, 404 for unknown or revoked frames", async () => {
    const w = fakeWorld();
    const { device } = await w.services.devices.register({ name: "Bedroom" });
    const updated = await w.services.devices.updateSettings(device.id, {
      slideshowFolderId: "1AbCdEfGhIjKlMnOp",
    });
    expect(updated.settings).toEqual({
      slideshowFolderId: "1AbCdEfGhIjKlMnOp",
      greetingName: null,
    });
    expect(w.devices.items.get(device.id)?.settings.slideshowFolderId).toBe("1AbCdEfGhIjKlMnOp");
    expect(
      (await w.services.devices.updateSettings(device.id, { slideshowFolderId: null })).settings,
    ).toEqual({ slideshowFolderId: null, greetingName: null });
    expect(
      (await w.services.devices.updateSettings(device.id, { greetingName: "  Nana " })).settings,
    ).toEqual({ slideshowFolderId: null, greetingName: "Nana" });
    await expect(
      w.services.devices.updateSettings(device.id, { greetingName: "" }),
    ).rejects.toThrow();
    await expect(
      w.services.devices.updateSettings(device.id, { slideshowFolderId: "../x" }),
    ).rejects.toThrow();
    await expect(w.services.devices.updateSettings("0".repeat(16), {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await w.services.devices.revoke(device.id);
    await expect(w.services.devices.updateSettings(device.id, {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("records a reported app version only when it changes", async () => {
    const w = fakeWorld();
    const { device } = await w.services.devices.register({ name: "Frame" });
    await w.services.devices.reportVersion(device.id, 3);
    expect(w.devices.items.get(device.id)).toMatchObject({
      appVersion: 3,
      appVersionAt: "2026-11-16T12:42:00.000Z",
    });
    w.clock.current = new Date("2026-11-16T13:00:00Z");
    await w.services.devices.reportVersion(device.id, 3);
    expect(w.devices.items.get(device.id)?.appVersionAt).toBe("2026-11-16T12:42:00.000Z");
    await w.services.devices.reportVersion(device.id, 4);
    expect((await w.services.devices.list())[0]).toMatchObject({
      appVersion: 4,
      appVersionAt: "2026-11-16T13:00:00.000Z",
    });
    await w.services.devices.reportVersion("0".repeat(16), 4); // unknown: ignored
    expect(w.devices.items.size).toBe(1);
  });
});
