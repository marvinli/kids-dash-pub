import type { Logger } from "../services/ports";

/** One JSON line per entry, which CloudWatch Logs Insights can query by field. */
export function jsonLogger(write: (line: string) => void = console.log): Logger {
  const log =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) =>
      write(JSON.stringify({ level, message, ...fields }));
  return { info: log("info"), warn: log("warn"), error: log("error") };
}
