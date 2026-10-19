import { describe, expect, it } from "vitest";
import { avatarProblem } from "../src/avatar.js";
import { AVATAR_SIDE, centerSquare, encodeAvatar } from "../src/client/avatar-file.js";

const png = "iVBORw0KGgo=";

describe("centerSquare", () => {
  it("takes the middle of a landscape image", () => {
    expect(centerSquare(400, 200)).toEqual({ x: 100, y: 0, side: 200 });
  });

  it("takes the middle of a portrait image", () => {
    expect(centerSquare(200, 500)).toEqual({ x: 0, y: 150, side: 200 });
  });

  it("keeps a square whole and rounds an odd margin down", () => {
    expect(centerSquare(AVATAR_SIDE, AVATAR_SIDE)).toEqual({ x: 0, y: 0, side: AVATAR_SIDE });
    expect(centerSquare(11, 4)).toEqual({ x: 3, y: 0, side: 4 });
  });
});

describe("encodeAvatar", () => {
  it("prefers WebP", () => {
    const asked: Array<[string, number | undefined]> = [];
    const avatar = encodeAvatar((mime, quality) => {
      asked.push([mime, quality]);
      return `data:${mime};base64,${png}`;
    });
    expect(avatar).toEqual({ mime: "image/webp", data: png });
    expect(asked).toEqual([["image/webp", 0.9]]);
  });

  it("accepts the PNG a browser without WebP encoding answers with", () => {
    expect(encodeAvatar(() => `data:image/png;base64,${png}`)).toEqual({ mime: "image/png", data: png });
  });

  it("falls back to PNG when the WebP is too large to store", () => {
    const huge = "A".repeat(160_000);
    const avatar = encodeAvatar((mime) => `data:${mime};base64,${mime === "image/webp" ? huge : png}`);
    expect(avatar).toEqual({ mime: "image/png", data: png });
  });

  it("returns nothing when no encoding can be stored", () => {
    expect(encodeAvatar(() => "data:,")).toBeUndefined();
    expect(encodeAvatar(() => `data:image/gif;base64,${png}`)).toBeUndefined();
  });

  it("only returns avatars the identity layer would publish", () => {
    const avatar = encodeAvatar((mime) => `data:${mime};base64,${png}`);
    expect(avatar).toBeDefined();
    expect(avatarProblem(avatar!)).toBeUndefined();
  });
});
