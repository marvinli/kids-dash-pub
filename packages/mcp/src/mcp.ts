import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool, toolsFor } from "./tools";
import type { AdminTransport } from "./transport";

export const INSTRUCTIONS = `Manage the kids' morning dashboard on the family photo frame.
Events are always added, changed and deleted in Google Calendar (the kids' calendars; the dashboard syncs every 15 minutes), never here.
Specials (field trips, playdates, no-school days, birthdays) are pinned at the top of the kid's day.
Keep titles and notes short and kid-friendly: the kids read them on the frame.
After changes, preview_dashboard shows exactly what the frame will display.`;

export function createMcpServer(
  client: AdminTransport,
  mode: "local" | "remote" = "local",
): McpServer {
  const server = new McpServer(
    { name: "kids-dash", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of toolsFor(mode)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => runTool(tool, client, input),
    );
  }
  return server;
}
