import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarProblem } from "../src/avatar.js";
import { AVATAR_SIDE, avatarFromFile, centerSquare, encodeAvatar } from "../src/client/avatar-file.js";

const png = "iVBORw0KGgo=";
const SOURCE_LIMIT = 25 * 1024 * 1024;

interface BrowserOptions {
  size?: [number, number];
  undecodable?: boolean;
  noContext?: boolean;
  drawFails?: boolean;
  encode?: (mime: string, quality?: number) => string;
}

function stubBrowser({ size = [10, 10], undecodable, noContext, drawFails, encode }: BrowserOptions = {}) {
  const bitmap = { width: size[0], height: size[1], close: vi.fn() };
  const draws: unknown[][] = [];
  const canvas = {
    width: 300,
    height: 150,
    getContext: () =>
      noContext
        ? null
        : {
            drawImage: (...args: unknown[]) => {
              if (drawFails) throw new Error("draw failed");
              draws.push(args);
            },
          },
    toDataURL: (mime: string, quality?: number) => encode?.(mime, quality) ?? `data:${mime};base64,${png}`,
  };
  const decode = vi.fn(async () => {
    if (undecodable) throw new Error("cannot decode");
    return bitmap;
  });
  const createElement = vi.fn(() => canvas);
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("document", { createElement });
  return { bitmap, canvas, draws, decode, createElement };
}

const file = (size: number): Blob => ({ size }) as Blob;

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(centerSquare(4, 11)).toEqual({ x: 0, y: 3, side: 4 });
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

describe("avatarFromFile", () => {
  it("refuses a source over the limit without decoding it", async () => {
    const { decode } = stubBrowser();
    await expect(avatarFromFile(file(SOURCE_LIMIT + 1))).resolves.toEqual({ problem: "tooLarge" });
    expect(decode).not.toHaveBeenCalled();
    await avatarFromFile(file(SOURCE_LIMIT));
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("reports an image that cannot be decoded as unreadable instead of throwing", async () => {
    stubBrowser({ undecodable: true });
    await expect(avatarFromFile(file(10))).resolves.toEqual({ problem: "unreadable" });
  });

  it("crops the centered square onto a square canvas, encodes it and releases the bitmap", async () => {
    const { bitmap, canvas, draws, createElement } = stubBrowser({ size: [400, 200] });
    await expect(avatarFromFile(file(10))).resolves.toEqual({ avatar: { mime: "image/webp", data: png } });
    expect(createElement).toHaveBeenCalledWith("canvas");
    expect([canvas.width, canvas.height]).toEqual([AVATAR_SIDE, AVATAR_SIDE]);
    expect(draws).toEqual([[bitmap, 100, 0, 200, 200, 0, 0, AVATAR_SIDE, AVATAR_SIDE]]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  const unusable: Array<[string, BrowserOptions]> = [
    ["a zero-width image", { size: [0, 100] }],
    ["a zero-height image", { size: [100, 0] }],
    ["a missing 2d context", { noContext: true }],
    ["a drawing failure", { drawFails: true }],
    ["an encoding that cannot be stored", { encode: () => "data:," }],
  ];

  it.each(unusable)("reports %s as unreadable and still releases the bitmap", async (_case, options) => {
    const { bitmap } = stubBrowser(options);
    await expect(avatarFromFile(file(10))).resolves.toEqual({ problem: "unreadable" });
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
