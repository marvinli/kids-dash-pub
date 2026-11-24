import { createHash } from "node:crypto";
import {
  assembleBundle,
  type BundleEnvelope,
  checkOffFrom,
  type DashboardBundle,
  dateRange,
  daysBetween,
  localDate,
} from "@kids-dash/core";
import { NotConfiguredError } from "./errors";
import type {
  ChoreStore,
  Clock,
  CompletionStore,
  DeviceStore,
  NoteStore,
  SettingsStore,
  Signer,
  SnapshotStore,
} from "./ports";
import { activeDevice, folderFor, readSlides } from "./slide-folders";

export interface BundleServiceDeps {
  clock: Clock;
  settings: SettingsStore;
  chores: ChoreStore;
  notes: NoteStore;
  snapshots: SnapshotStore;
  completions: CompletionStore;
  devices: DeviceStore;
  signer: Signer;
}

export type SignedBundleResult =
  | { status: "not-modified"; etag: string }
  | { status: "ok"; etag: string; envelope: BundleEnvelope };

export class BundleService {
  constructor(private readonly deps: BundleServiceDeps) {}

  /**
   * The dashboard as of now, from stored state. Nothing external is called.
   * For a frame (`deviceId`), its own settings apply and it is named in the
   * bundle; without one (an admin preview) the family's settings apply.
   */
  async build(deviceId?: string): Promise<DashboardBundle> {
    const { deps } = this;
    const [settings, device] = await Promise.all([
      deps.settings.get(),
      deviceId === undefined ? null : activeDevice(deps.devices, deviceId),
    ]);
    if (!settings) throw new NotConfiguredError();
    const now = deps.clock.now();
    const today = localDate(now, settings.timezone);

    // Every earlier day the check-off window covers, for the chore counts on the week.
    const earlier = dateRange(checkOffFrom(today), daysBetween(checkOffFrom(today), today));
    const [chores, notes, calendar, weather, trivia, facts, completed, past, slides, app] =
      await Promise.all([
        deps.chores.list(),
        deps.notes.listBetween(today, today),
        deps.snapshots.getCalendar(),
        deps.snapshots.getWeather(),
        deps.snapshots.getTrivia(),
        deps.snapshots.getToday(),
        deps.completions.listDone(today),
        Promise.all(earlier.map((date) => deps.completions.listDone(date))),
        readSlides(deps.snapshots, folderFor(device, settings), settings.slideshowFolderId),
        deps.snapshots.getApp(),
      ]);

    return assembleBundle({
      now,
      settings,
      events: calendar?.events ?? [],
      weather: weather?.date === today ? weather.weather : null,
      trivia: trivia?.date === today ? trivia.questions : [],
      onThisDay: facts?.date === today ? facts.history : [],
      place: facts?.date === today ? facts.place : null,
      chores,
      notes,
      completed,
      history: new Map(earlier.map((date, i) => [date, past[i] ?? new Set<string>()])),
      slides: slides?.slides ?? [],
      app: app && {
        versionCode: app.versionCode,
        versionName: app.versionName,
        sha256: app.sha256,
      },
      device: device && {
        id: device.id,
        name: device.name,
        greetingName: device.settings.greetingName,
      },
    });
  }

  /**
   * The signed envelope, or not-modified when the frame already has this
   * content. The ETag ignores `generatedAt`, so an unchanged dashboard is a
   * cheap 304 without a KMS call.
   */
  async signed(deviceId: string | undefined, ifNoneMatch?: string): Promise<SignedBundleResult> {
    const bundle = await this.build(deviceId);
    const etag = contentEtag(bundle);
    if (ifNoneMatch === etag) return { status: "not-modified", etag };

    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const signature = await this.deps.signer.sign(bytes);
    return {
      status: "ok",
      etag,
      envelope: {
        payload: Buffer.from(bytes).toString("base64url"),
        signature: Buffer.from(signature).toString("base64"),
        keyId: this.deps.signer.keyId,
      },
    };
  }
}

export function contentEtag(bundle: DashboardBundle): string {
  const { generatedAt: _ignored, ...content } = bundle;
  const digest = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return `"${digest.slice(0, 32)}"`;
}
