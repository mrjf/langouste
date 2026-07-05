/**
 * Minimal, dependency-free runtime guards for Claude `tool_use` output.
 *
 * `toolUse.input` is typed `unknown` at runtime — the SDK does not validate it
 * against the tool schema. Casting it straight to a TypeScript type with `as`
 * trusts a shape the compiler can't check, so a malformed or drifted response
 * surfaces far from its cause (a `.map` over `undefined`, a missing field read
 * as `undefined`). These helpers validate the top-level shape at the parse
 * boundary and throw a descriptive error instead. Element-level validation is
 * intentionally out of scope; callers already wrap these services in try/catch.
 */

export function toolInputObject(input: unknown, tool: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Malformed ${tool} tool output: expected an object`);
  }
  return input as Record<string, unknown>;
}

/** Require an array field. Throws if absent or not an array. */
export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed tool output: "${field}" must be an array`);
  }
  return value;
}

/** Require a string field. Throws if absent or not a string. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Malformed tool output: "${field}" must be a string`);
  }
  return value;
}
