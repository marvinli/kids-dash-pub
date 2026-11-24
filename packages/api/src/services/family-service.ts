import {
  Chore,
  type ChoreInput,
  dateRange,
  type IsoDate,
  Note,
  type NoteInput,
  type Owner,
  occursOn,
  type PlannedEvent,
  type Settings,
  SettingsInput,
} from "@kids-dash/core";
import { InvalidRequestError, NotConfiguredError, NotFoundError } from "./errors";
import type { ChoreStore, NoteStore, PhotoStore, SettingsStore, SnapshotStore } from "./ports";

export interface FamilyServiceDeps {
  settings: SettingsStore;
  chores: ChoreStore;
  notes: NoteStore;
  snapshots: SnapshotStore;
  photos: PhotoStore;
}

/** Admin use cases for settings, chores, notes and events. */
export class FamilyService {
  constructor(private readonly deps: FamilyServiceDeps) {}

  async getSettings(): Promise<Settings | null> {
    return this.deps.settings.get();
  }

  /** Replaces settings. Kids keep their photos; a removed kid's photo is deleted. */
  async updateSettings(input: unknown): Promise<Settings> {
    const parsed = SettingsInput.parse(input);
    const previous = await this.deps.settings.get();
    const photos = new Map(previous?.kids.map((k) => [k.id, k.photo]) ?? []);
    const next: Settings = {
      ...parsed,
      kids: parsed.kids.map((kid) => ({ ...kid, photo: photos.get(kid.id) ?? null })),
    };
    await this.deps.settings.put(next);

    const kept = new Set(next.kids.map((k) => k.id));
    for (const kid of previous?.kids ?? []) {
      if (!kept.has(kid.id) && kid.photo) await this.deps.photos.delete(kid.photo.key);
    }
    return next;
  }

  async requireSettings(): Promise<Settings> {
    const settings = await this.deps.settings.get();
    if (!settings) throw new NotConfiguredError();
    return settings;
  }

  async listChores(kidId?: string): Promise<Chore[]> {
    const chores = await this.deps.chores.list();
    return kidId ? chores.filter((c) => c.kidId === kidId) : chores;
  }

  async putChore(kidId: string, choreId: string, input: ChoreInput): Promise<Chore> {
    await this.requireKid(kidId);
    const chore = Chore.parse({ ...input, id: choreId, kidId });
    await this.deps.chores.put(chore);
    return chore;
  }

  async deleteChore(kidId: string, choreId: string): Promise<void> {
    if (!(await this.deps.chores.delete(kidId, choreId))) {
      throw new NotFoundError(`No chore ${choreId} for ${kidId}`);
    }
  }

  async listNotes(from: IsoDate, to: IsoDate): Promise<Note[]> {
    return this.deps.notes.listBetween(from, to);
  }

  async putNote(date: IsoDate, noteId: string, input: NoteInput): Promise<Note> {
    const note = Note.parse({ ...input, id: noteId, date });
    await this.requireOwner(note.owner);
    await this.deps.notes.put(note);
    return note;
  }

  async deleteNote(date: IsoDate, noteId: string): Promise<void> {
    if (!(await this.deps.notes.delete(date, noteId))) {
      throw new NotFoundError(`No note ${noteId} on ${date}`);
    }
  }

  /** Synced Google events that show on any day in [from, to]. */
  async listEvents(from: IsoDate, to: IsoDate): Promise<PlannedEvent[]> {
    if (to < from) throw new InvalidRequestError("`to` is before `from`");
    const days = dateRange(from, Math.min(daysBetween(from, to) + 1, 62));
    const calendar = await this.deps.snapshots.getCalendar();
    return (calendar?.events ?? [])
      .filter((e) => days.some((d) => occursOn(e, d)))
      .sort((a, b) => a.start.date.localeCompare(b.start.date) || a.id.localeCompare(b.id));
  }

  private async requireKid(kidId: string): Promise<void> {
    const settings = await this.requireSettings();
    if (!settings.kids.some((k) => k.id === kidId)) {
      throw new InvalidRequestError(`Unknown kid ${kidId}; add them to settings first`);
    }
  }

  private async requireOwner(owner: Owner): Promise<void> {
    if (owner.kind === "kid") await this.requireKid(owner.kidId);
  }
}

const DAY_MS = 86_400_000;

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
