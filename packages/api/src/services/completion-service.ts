import { ChoreCompletionInput, checkOffFrom, localDate } from "@kids-dash/core";
import { InvalidRequestError, NotConfiguredError, NotFoundError } from "./errors";
import type { ChoreStore, Clock, CompletionStore, SettingsStore } from "./ports";

export interface CompletionServiceDeps {
  clock: Clock;
  settings: SettingsStore;
  chores: ChoreStore;
  completions: CompletionStore;
}

/** Chore check-offs from the frame. */
export class CompletionService {
  constructor(private readonly deps: CompletionServiceDeps) {}

  async set(kidId: string, choreId: string, input: unknown): Promise<void> {
    const { date, done } = ChoreCompletionInput.parse(input);
    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();

    // Missed days can be caught up back to last week's Monday (the week
    // screen's first page); days ahead cannot be done yet.
    const today = localDate(this.deps.clock.now(), settings.timezone);
    const from = checkOffFrom(today);
    if (date < from || date > today) {
      throw new InvalidRequestError(`Check-offs are only accepted from ${from} to ${today}`);
    }
    const chores = await this.deps.chores.list();
    if (!chores.some((c) => c.kidId === kidId && c.id === choreId)) {
      throw new NotFoundError(`No chore ${choreId} for ${kidId}`);
    }
    await this.deps.completions.set(date, kidId, choreId, done);
  }
}
