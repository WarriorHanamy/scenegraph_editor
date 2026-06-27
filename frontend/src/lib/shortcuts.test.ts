import { describe, expect, test } from "bun:test";
import { isConnectShortcut } from "./shortcuts";

describe("keyboard shortcuts", () => {
  test("recognizes E by key value", () => {
    expect(isConnectShortcut({ code: "KeyE", key: "e" })).toBe(true);
    expect(isConnectShortcut({ code: "KeyE", key: "E" })).toBe(true);
  });

  test("recognizes the physical E key during IME composition", () => {
    expect(isConnectShortcut({ code: "KeyE", key: "Process" })).toBe(true);
  });

  test("ignores other keys", () => {
    expect(isConnectShortcut({ code: "KeyG", key: "g" })).toBe(false);
  });
});
