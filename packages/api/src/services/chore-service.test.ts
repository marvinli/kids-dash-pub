import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { choreSlug, FRAME_CHORES_PER_HOUR, MAX_CHORES_PER_KID, uniqueId } from "./chore-service";
import { InvalidRequestError, NotConfiguredError, RateLimitedError } from "./errors";

const DEVICE = "0123456789abcdef";

function setup(settings?: Parameters<typeof fakeWorld>[0]) {
  const w = settings === undefined ? fakeWorld() : fakeWorld(settings);
  const add = (input: unknown) => w.services.chores.addFromFrame(DEVICE, input);
  return { w, add };
}

describe("ChoreService.addFromFrame", () => {
  it("saves the chore after the kid's others, with an id from the title", async () => {
    const { w, add } = setup();
    await w.chores.put({
      id: "make-bed",
      kidId: "maya",
      title: "Make your bed",
      sticker: "bed",
      period: "morning",
      days: [0, 6],
      order: 3,
    });
    await w.chores.put({
      id: "feed-fish",
      kidId: "theo",
      title: "Feed fish",
      sticker: "fish",
      period: "evening",
      days: [],
      order: 9,
    });

    const chore = await add({
      kidId: "maya",
      title: "  Feed Mr. Fish!  ",
      period: "afterSchool",
      days: [5, 1, 3],
      sticker: "fish",
    });
    expect(chore).toEqual({
      id: "feed-mr-fish",
      kidId: "maya",
      title: "Feed Mr. Fish!",
      sticker: "fish",
      period: "afterSchool",
      days: [1, 3, 5],
      order: 4,
    });
    expect(w.chores.items.get("maya#feed-mr-fish")).toEqual(chore);
    expect(w.logger.lines).toContainEqual(
      expect.objectContaining({ message: "frame added chore" }),
    );
  });

  it("never overwrites an existing chore with the same title", async () => {
    const { w, add } = setup();
    const first = await add({ kidId: "theo", title: "Make bed", period: "morning" });
    const second = await add({ kidId: "theo", title: "Make bed", period: "evening" });
    expect([first.id, second.id]).toEqual(["make-bed", "make-bed-2"]);
    expect([first.order, second.order]).toEqual([0, 1]);
    expect(second).toMatchObject({ sticker: "star", days: [] });
    expect(w.chores.items.size).toBe(2);
  });

  it("refuses unknown kids, bad input and a full list", async () => {
    const { w, add } = setup();
    await expect(add({ kidId: "sam", title: "x", period: "morning" })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    await expect(add({ kidId: "maya", title: "", period: "morning" })).rejects.toThrow();
    for (let i = 0; i < MAX_CHORES_PER_KID; i++) {
      await w.chores.put({
        id: `c${i}`,
        kidId: "maya",
        title: "x",
        sticker: "star",
        period: "morning",
        days: [],
        order: i,
      });
    }
    await expect(add({ kidId: "maya", title: "x", period: "morning" })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
  });

  it("needs settings", async () => {
    const { add } = setup(null);
    await expect(add({ kidId: "maya", title: "x", period: "morning" })).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
  });

  it("limits how many chores a frame adds per hour", async () => {
    const { w, add } = setup();
    for (let i = 0; i < FRAME_CHORES_PER_HOUR; i++) {
      await add({ kidId: "theo", title: `Chore ${i}`, period: "morning" });
    }
    await expect(
      add({ kidId: "theo", title: "One more", period: "morning" }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(w.chores.items.size).toBe(FRAME_CHORES_PER_HOUR);
  });
});

describe("choreSlug and uniqueId", () => {
  it("makes slugs that fit core's Slug", () => {
    expect(choreSlug("Brush Teeth")).toBe("brush-teeth");
    expect(choreSlug("Café — tidy!")).toBe("cafe-tidy");
    expect(choreSlug("🙂")).toBe("chore");
    const long = choreSlug("a ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(34);
    expect(long.endsWith("-")).toBe(false);
  });

  it("numbers duplicates", () => {
    expect(uniqueId("bed", [])).toBe("bed");
    expect(uniqueId("bed", ["bed", "bed-2"])).toBe("bed-3");
  });
});
