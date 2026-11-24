import { describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { backdropFor } from "./backdrop";
import { backdropFiles } from "./sky";
import { sampleBundle } from "./test-bundle";

// Two paintings in the build: the season's original and a fun scene.
vi.mock("./backdrops.json", () => ({
  default: {
    fall: { day: 0.84, dusk: 0.39, night: 0.05 },
    "outer-space": { day: 0.1, dusk: 0.05, night: 0.01 },
  },
}));

function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  const log = vi.fn();
  const app = new App({
    root,
    native: { ready: vi.fn(), setChore: vi.fn() },
    now: () => new Date("2026-11-16T12:42:00Z"),
    log,
  });
  return { app, root, log };
}

/** A day whose rotation picks the fun scene when both paintings are there. */
function funDay(): string {
  const both = new Set(["fall", "outer-space"]);
  for (let d = 16; d < 30; d++) {
    const date = `2026-11-${d}`;
    if (backdropFor(date, both) === "outer-space") return date;
  }
  throw new Error("no fun day");
}

describe("App.setArt", () => {
  it("rotates in a downloaded painting only once all its files are on the frame", () => {
    const t = setup();
    const bundle = { ...sampleBundle(), date: funDay() };
    t.app.render(JSON.stringify(bundle));
    // Before the shell says anything: every painting in the build.
    expect(t.root.dataset.backdrop).toBe("outer-space");

    const fall = backdropFiles("fall");
    const space = backdropFiles("outer-space");
    t.app.setArt(JSON.stringify([...fall, ...space.slice(0, 5)]));
    expect(t.root.dataset.backdrop).toBe("fall");
    expect(t.root.style.getPropertyValue("--backdrop-image")).toContain("bg-fall");

    t.app.setArt(JSON.stringify([...fall, ...space]));
    expect(t.root.dataset.backdrop).toBe("outer-space");
  });

  it("ignores a malformed list", () => {
    const t = setup();
    t.app.setArt('{"nope":1}');
    t.app.setArt("not json");
    expect(t.log).toHaveBeenCalledWith("Ignoring malformed art list");
  });
});
