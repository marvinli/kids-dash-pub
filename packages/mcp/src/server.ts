import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "./admin-client";
import { createMcpServer } from "./mcp";

// stdout is the MCP channel; anything diagnostic goes to stderr.
const server = createMcpServer(clientFromEnv());
await server.connect(new StdioServerTransport());
console.error("kids-dash MCP ready");
