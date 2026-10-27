import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseForm, zfd } from "./actions";

const schema = z.object({ name: zfd.requiredText(), agree: zfd.checkbox(), note: zfd.text(), count: zfd.optionalInt(), price: zfd.cents() });

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("parseForm + zfd", () => {
  it("treats a missing checkbox as false", () => {
    const r = parseForm(schema, form({ name: "A", price: "10" }));
    expect(r.error).toBeUndefined();
    expect(r.data?.agree).toBe(false);
  });
  it("reads checked boxes, blank text and cents", () => {
    const r = parseForm(schema, form({ name: "A", agree: "on", note: "  ", count: "", price: "49.99" }));
    expect(r.data).toEqual({ name: "A", agree: true, note: undefined, count: undefined, price: 4999 });
  });
  it("reports the failing field", () => {
    const r = parseForm(schema, form({ name: "", price: "1" }));
    expect(r.error?.error).toMatch(/^name:/);
  });
});
