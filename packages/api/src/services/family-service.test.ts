import { sampleEvent } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { FAMILY, fakeWorld } from "../../test/fakes";
import { InvalidRequestError, NotConfiguredError, NotFoundError } from "./errors";

const photo = {
  key: "photos/maya/a.jpg",
  sha256: "a".repeat(64),
  contentType: "image/jpeg",
} as const;

describe("settings", () => {
  it("keeps photos for kids that stay and deletes photos of removed kids", async () => {
    const w = fakeWorld({
      ...FAMILY,
      kids: FAMILY.kids.map((k) => ({ ...k, photo: { ...photo, key: `photos/${k.id}/a.jpg` } })),
    });
    await w.photos.put("photos/theo/a.jpg", new Uint8Array([1]), "image/jpeg");

    const next = await w.services.family.updateSettings({
      timezone: "America/New_York",
      kids: [{ id: "maya", name: "Maya B", color: "purple" }],
    });

    expect(next.kids).toEqual([
      expect.objectContaining({
        name: "Maya B",
        photo: expect.objectContaining({ key: "photos/maya/a.jpg" }),
      }),
    ]);
    expect(w.photos.objects.has("photos/theo/a.jpg")).toBe(false);
    expect(await w.services.family.getSettings()).toEqual(next);
  });

  it("creates settings from nothing", async () => {
    const w = fakeWorld(null);
    const next = await w.services.family.updateSettings({ timezone: "Europe/London" });
    expect(next).toMatchObject({ kids: [], location: null, sharedCalendarIds: [] });
    await expect(fakeWorld(null).services.family.requireSettings()).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
  });
});

describe("chores", () => {
  it("adds, lists by kid and deletes", async () => {
    const w = fakeWorld();
    await w.services.family.putChore("maya", "bed", { title: "Make your bed", sticker: "bed" });
    await w.services.family.putChore("theo", "toys", { title: "Put toys away", sticker: "toys" });
    expect((await w.services.family.listChores("maya")).map((c) => c.id)).toEqual(["bed"]);
    expect(await w.services.family.listChores()).toHaveLength(2);
    await w.services.family.deleteChore("maya", "bed");
    await expect(w.services.family.deleteChore("maya", "bed")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses chores for unknown kids", async () => {
    const w = fakeWorld();
    await expect(w.services.family.putChore("sam", "bed", { title: "Bed" })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
  });
});

describe("notes", () => {
  it("adds for a kid or everyone, lists by range and deletes", async () => {
    const w = fakeWorld();
    await w.services.family.putNote("2026-11-16", "book", {
      owner: { kind: "kid", kidId: "maya" },
      text: "Book",
    });
    await w.services.family.putNote("2026-11-18", "pj", {
      owner: { kind: "everyone" },
      text: "Pajama day",
    });
    expect(
      (await w.services.family.listNotes("2026-11-16", "2026-11-17")).map((n) => n.id),
    ).toEqual(["book"]);
    await w.services.family.deleteNote("2026-11-16", "book");
    await expect(w.services.family.deleteNote("2026-11-16", "book")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      w.services.family.putNote("2026-11-16", "x", {
        owner: { kind: "kid", kidId: "sam" },
        text: "?",
      }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
  });
});

describe("events", () => {
  it("lists the synced events overlapping the range, by day", async () => {
    const w = fakeWorld();
    expect(await w.services.family.listEvents("2026-11-16", "2026-11-22")).toEqual([]);
    w.snapshots.calendar = {
      syncedAt: "x",
      events: [
        sampleEvent("g-1", { owner: { kind: "everyone" }, title: "No school", date: "2026-11-18" }),
        sampleEvent("g-2", {
          owner: { kind: "kid", kidId: "maya" },
          title: "Field trip",
          date: "2026-11-16",
          time: "09:00",
          special: true,
        }),
        sampleEvent("g-3", { owner: { kind: "everyone" }, title: "Later", date: "2026-12-25" }),
      ],
    };

    const events = await w.services.family.listEvents("2026-11-16", "2026-11-22");
    expect(events.map((e) => e.id)).toEqual(["g-2", "g-1"]);
  });

  it("validates ranges", async () => {
    const w = fakeWorld();
    await expect(w.services.family.listEvents("2026-11-20", "2026-11-16")).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
  });
});
