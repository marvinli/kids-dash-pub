import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./mcp";
import { runTool, TOOLS, toolsFor } from "./tools";
import { AdminApiError, type AdminTransport as AdminClient } from "./transport";

function fakeClient(result: unknown = { ok: true }) {
  const request = vi.fn(async (..._args: unknown[]) => result);
  return { request, client: { request } as unknown as AdminClient };
}

const byName = (name: string) => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

async function call(name: string, input: unknown, result?: unknown) {
  const fake = fakeClient(result);
  const output = await runTool(byName(name), fake.client, input);
  return { output, calls: fake.request.mock.calls };
}

describe("tools map onto admin API calls", () => {
  it.each([
    ["get_settings", {}, ["GET", "/admin/settings"]],
    [
      "update_settings",
      { timezone: "UTC" },
      [
        "PUT",
        "/admin/settings",
        {
          body: {
            timezone: "UTC",
            location: null,
            kids: [],
            sharedCalendarIds: [],
            sleep: null,
            slideshowFolderId: null,
          },
        },
      ],
    ],
    ["list_chores", { kidId: "maya" }, ["GET", "/admin/chores", { query: { kidId: "maya" } }]],
    [
      "set_chore",
      { kidId: "maya", choreId: "bed", title: "Make bed", sticker: "bed" },
      [
        "PUT",
        "/admin/chores/maya/bed",
        { body: { title: "Make bed", sticker: "bed", period: "morning", days: [], order: 0 } },
      ],
    ],
    ["delete_chore", { kidId: "maya", choreId: "bed" }, ["DELETE", "/admin/chores/maya/bed"]],
    [
      "list_notes",
      { from: "2026-11-16", to: "2026-11-17" },
      ["GET", "/admin/notes", { query: { from: "2026-11-16", to: "2026-11-17" } }],
    ],
    [
      "set_note",
      { date: "2026-11-16", noteId: "book", owner: { kind: "everyone" }, text: "Library" },
      [
        "PUT",
        "/admin/notes/2026-11-16/book",
        { body: { owner: { kind: "everyone" }, text: "Library" } },
      ],
    ],
    [
      "delete_note",
      { date: "2026-11-16", noteId: "book" },
      ["DELETE", "/admin/notes/2026-11-16/book"],
    ],
    [
      "list_events",
      { from: "2026-11-16", to: "2026-11-22" },
      ["GET", "/admin/events", { query: { from: "2026-11-16", to: "2026-11-22" } }],
    ],
    ["delete_kid_photo", { kidId: "theo" }, ["DELETE", "/admin/kids/theo/photo"]],
    ["list_devices", {}, ["GET", "/admin/devices"]],
    ["list_incidents", {}, ["GET", "/admin/incidents", { query: {} }]],
    [
      "list_incidents",
      { deviceId: "0123456789abcdef", limit: 5 },
      ["GET", "/admin/incidents", { query: { deviceId: "0123456789abcdef", limit: "5" } }],
    ],
    [
      "get_incident",
      { incidentId: "0123456789abcdef" },
      ["GET", "/admin/incidents/0123456789abcdef"],
    ],
    [
      "register_device",
      { name: "Frame" },
      ["POST", "/admin/devices", { body: { name: "Frame", role: "device" } }],
    ],
    [
      "revoke_device",
      { deviceId: "0123456789abcdef" },
      ["DELETE", "/admin/devices/0123456789abcdef"],
    ],
    [
      "set_device_settings",
      { deviceId: "0123456789abcdef", slideshowFolderId: "1AbCdEfGhIjKlMnOp" },
      [
        "PUT",
        "/admin/devices/0123456789abcdef/settings",
        { body: { slideshowFolderId: "1AbCdEfGhIjKlMnOp", greetingName: null } },
      ],
    ],
    [
      "set_device_settings",
      { deviceId: "0123456789abcdef", slideshowFolderId: null },
      [
        "PUT",
        "/admin/devices/0123456789abcdef/settings",
        { body: { slideshowFolderId: null, greetingName: null } },
      ],
    ],
    [
      "set_device_settings",
      { deviceId: "0123456789abcdef", slideshowFolderId: null, greetingName: "Nana" },
      [
        "PUT",
        "/admin/devices/0123456789abcdef/settings",
        { body: { slideshowFolderId: null, greetingName: "Nana" } },
      ],
    ],
    ["sync_now", {}, ["POST", "/admin/sync"]],
    ["preview_dashboard", {}, ["GET", "/admin/bundle"]],
  ])("%s", async (name, input, expected) => {
    const { output, calls } = await call(name, input);
    expect(output.isError).toBeUndefined();
    expect(calls[0]).toEqual(expected);
  });

  it("offers remote agents everything except local files and credentials", () => {
    expect(toolsFor("remote").map((t) => t.name)).not.toEqual(
      expect.arrayContaining(["set_kid_photo"]),
    );
    expect(
      toolsFor("remote")
        .map((t) => t.name)
        .sort(),
    ).toEqual(
      TOOLS.map((t) => t.name)
        .filter(
          (n) =>
            ![
              "set_kid_photo",
              "delete_kid_photo",
              "list_devices",
              "register_device",
              "revoke_device",
              "set_device_settings",
              "list_incidents",
              "get_incident",
            ].includes(n),
        )
        .sort(),
    );
    expect(toolsFor("local")).toBe(TOOLS);
  });

  it("covers every tool", () => {
    expect(TOOLS).toHaveLength(19);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });
});

describe("set_kid_photo", () => {
  it("reads the file and uploads it as base64 with its content type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kids-dash-"));
    const path = join(dir, "maya.JPG");
    await writeFile(path, Buffer.from([0xff, 0xd8, 0xff]));
    const { calls } = await call("set_kid_photo", { kidId: "maya", path });
    expect(calls[0]).toEqual([
      "PUT",
      "/admin/kids/maya/photo",
      { body: { contentType: "image/jpeg", dataBase64: "/9j/" } },
    ]);
  });

  it("refuses other file types", async () => {
    const { output } = await call("set_kid_photo", { kidId: "maya", path: "/tmp/x.gif" });
    expect(output).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(".jpg") }],
    });
  });
});

describe("runTool", () => {
  it("rejects invalid input before calling the API", async () => {
    const { output, calls } = await call("set_chore", { kidId: "Maya!", choreId: "bed" });
    expect(output.isError).toBe(true);
    expect(output.content[0]?.text).toMatch(/^Invalid input: kidId: /);
    expect(calls).toHaveLength(0);
  });

  it("explains API rejections", async () => {
    const tool = byName("get_settings");
    const client = {
      request: async () => {
        throw new AdminApiError(409, { error: "not_configured" });
      },
    } as unknown as AdminClient;
    const output = await runTool(tool, client, undefined);
    expect(output).toEqual({
      isError: true,
      content: [
        { type: "text", text: 'The dashboard API rejected this (409): {"error":"not_configured"}' },
      ],
    });
  });

  it("reports an empty success as ok", async () => {
    const { output } = await call("delete_note", { date: "2026-11-16", noteId: "x" }, undefined);
    expect(JSON.parse(output.content[0]?.text ?? "")).toEqual({ ok: true });
  });

  it("stringifies non-Error failures", async () => {
    const client = { request: () => Promise.reject("boom") } as unknown as AdminClient;
    expect((await runTool(byName("get_settings"), client, {})).content[0]?.text).toBe("boom");
  });
});

describe("MCP server", () => {
  it("lists every tool and runs one over the protocol", async () => {
    const fake = fakeClient({ settings: null });
    const server = createMcpServer(fake.client);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: "test", version: "1" });
    await mcpClient.connect(clientTransport);

    const { tools } = await mcpClient.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    // Events are edited in Google Calendar only.
    expect(tools.map((t) => t.name)).not.toContain("set_event");
    expect(tools.map((t) => t.name)).not.toContain("delete_event");
    const setNote = tools.find((t) => t.name === "set_note");
    expect(setNote?.inputSchema.required).toEqual(
      expect.arrayContaining(["date", "noteId", "owner", "text"]),
    );

    const result = await mcpClient.callTool({ name: "get_settings", arguments: {} });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ settings: null }, null, 2) },
    ]);
    expect(mcpClient.getInstructions()).toContain("Google Calendar");
    await mcpClient.close();
  });
});
