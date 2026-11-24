import { type Chore, FrameChoreInput } from "@kids-dash/core";
import { InvalidRequestError, NotConfiguredError, RateLimitedError } from "./errors";
import type { ChoreStore, Clock, CounterStore, Logger, SettingsStore } from "./ports";

/** Chores one frame may add per clock hour. */
export const FRAME_CHORES_PER_HOUR = 20;
/** A kid's chore list stays short enough to manage. */
export const MAX_CHORES_PER_KID = 30;

export interface ChoreServiceDeps {
  clock: Clock;
  settings: SettingsStore;
  chores: ChoreStore;
  counters: CounterStore;
  logger: Logger;
}

/** Chores someone adds on a frame's Chores screen. */
export class ChoreService {
  constructor(private readonly deps: ChoreServiceDeps) {}

  async addFromFrame(deviceId: string, input: unknown): Promise<Chore> {
    const add = FrameChoreInput.parse(input);
    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();
    if (!settings.kids.some((k) => k.id === add.kidId)) {
      throw new InvalidRequestError(`No kid ${add.kidId}`);
    }

    const theirs = (await this.deps.chores.list()).filter((c) => c.kidId === add.kidId);
    if (theirs.length >= MAX_CHORES_PER_KID) {
      throw new InvalidRequestError(`${add.kidId} already has ${MAX_CHORES_PER_KID} chores`);
    }

    const now = this.deps.clock.now();
    const hour = now.toISOString().slice(0, 13);
    const count = await this.deps.counters.increment(
      `frame-chores#${deviceId}#${hour}`,
      new Date(now.getTime() + 2 * 3600 * 1000),
    );
    if (count > FRAME_CHORES_PER_HOUR) {
      throw new RateLimitedError("Too many chores added from this frame; try again later");
    }

    const chore: Chore = {
      id: uniqueId(
        choreSlug(add.title),
        theirs.map((c) => c.id),
      ),
      kidId: add.kidId,
      title: add.title,
      sticker: add.sticker,
      period: add.period,
      days: [...add.days].sort((a, b) => a - b),
      order: theirs.reduce((max, c) => Math.max(max, c.order + 1), 0),
    };
    await this.deps.chores.put(chore);
    this.deps.logger.info("frame added chore", { deviceId, kidId: chore.kidId, choreId: chore.id });
    return chore;
  }
}

/** "Feed Mr. Fish!" → "feed-mr-fish"; a title with no letters or digits → "chore". */
export function choreSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/, "");
  return slug || "chore";
}

/** `base`, or `base-2`, `base-3`… when the kid already has that id. */
export function uniqueId(base: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}
