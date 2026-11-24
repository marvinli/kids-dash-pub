import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type CredentialRole,
  DeviceInput,
  DeviceSettings,
  type DeviceSummary,
} from "@kids-dash/core";
import { NotFoundError } from "./errors";
import type { Clock, DeviceRecord, DeviceStore } from "./ports";

/** Writing lastSeenAt on every request would be one write per poll; this is plenty. */
export const LAST_SEEN_RESOLUTION_MS = 10 * 60 * 1000;

const TOKEN_PATTERN = /^([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;

export interface DeviceServiceDeps {
  clock: Clock;
  devices: DeviceStore;
}

/**
 * Device credentials. A token is `<id>.<secret>` with a 256-bit secret; only the
 * secret's sha256 is stored, so the table never holds a usable credential.
 */
export class DeviceService {
  constructor(private readonly deps: DeviceServiceDeps) {}

  async register(input: unknown): Promise<{ device: DeviceSummary; token: string }> {
    const { name, role } = DeviceInput.parse(input);
    const id = randomBytes(8).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    const record: DeviceRecord = {
      id,
      name,
      role,
      secretHash: hashSecret(secret),
      createdAt: this.deps.clock.now().toISOString(),
      lastSeenAt: null,
      revokedAt: null,
      settings: DeviceSettings.parse({}),
      appVersion: null,
      appVersionAt: null,
    };
    await this.deps.devices.put(record);
    return { device: summary(record), token: `${id}.${secret}` };
  }

  async list(): Promise<DeviceSummary[]> {
    return (await this.deps.devices.list()).map(summary);
  }

  async revoke(id: string): Promise<DeviceSummary> {
    const record = await this.deps.devices.get(id);
    if (!record) throw new NotFoundError(`No device ${id}`);
    if (record.revokedAt) return summary(record);
    const revoked = { ...record, revokedAt: this.deps.clock.now().toISOString() };
    await this.deps.devices.put(revoked);
    return summary(revoked);
  }

  /** Replaces a frame's own settings (null fields fall back to the family's). */
  async updateSettings(id: string, input: unknown): Promise<DeviceSummary> {
    const settings = DeviceSettings.parse(input);
    const record = await this.deps.devices.get(id);
    if (!record || record.revokedAt) throw new NotFoundError(`No device ${id}`);
    const updated = { ...record, settings };
    await this.deps.devices.put(updated);
    return summary(updated);
  }

  /** Records the app build a frame says it runs; written only when it changes. */
  async reportVersion(id: string, versionCode: number): Promise<void> {
    const record = await this.deps.devices.get(id);
    if (!record || record.appVersion === versionCode) return;
    await this.deps.devices.put({
      ...record,
      appVersion: versionCode,
      appVersionAt: this.deps.clock.now().toISOString(),
    });
  }

  /** Who a valid, unrevoked token belongs to; null otherwise. */
  async authenticate(
    token: string | undefined,
  ): Promise<{ id: string; role: CredentialRole } | null> {
    const match = TOKEN_PATTERN.exec(token?.replace(/^Bearer\s+/i, "") ?? "");
    if (!match) return null;
    const [, id = "", secret = ""] = match;
    const record = await this.deps.devices.get(id);
    if (!record || record.revokedAt) return null;

    const expected = Buffer.from(record.secretHash, "hex");
    const actual = Buffer.from(hashSecret(secret), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    const now = this.deps.clock.now();
    const lastSeen = record.lastSeenAt ? Date.parse(record.lastSeenAt) : 0;
    if (now.getTime() - lastSeen >= LAST_SEEN_RESOLUTION_MS) {
      await this.deps.devices.put({ ...record, lastSeenAt: now.toISOString() });
    }
    return { id, role: record.role };
  }
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function summary({ secretHash: _secret, ...rest }: DeviceRecord): DeviceSummary {
  return rest;
}
