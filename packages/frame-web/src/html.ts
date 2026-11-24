/**
 * Tiny HTML templating: interpolated values are escaped unless wrapped in
 * `raw()`, and arrays are joined. Bundle text comes from calendars other people
 * edit, so nothing reaches innerHTML unescaped by accident.
 */
export interface Raw {
  readonly __raw: string;
}

export function raw(value: string): Raw {
  return { __raw: value };
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

type Value = string | number | boolean | null | undefined | Raw | Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "object") return value.__raw;
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return raw(out);
}
