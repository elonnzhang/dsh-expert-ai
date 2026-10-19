import { avatarFromDataUrl } from "../avatar.js";
import type { ExpertIdentityAvatar } from "../types.js";

/** Edge length, in pixels, of the stored square. */
export const AVATAR_SIDE = 160;
/** Source images larger than this are not decoded. */
export const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024;

/** Preferred encodings in order; a browser that cannot write WebP answers with PNG, which is accepted too. */
const ENCODINGS: ReadonlyArray<readonly [mime: string, quality?: number]> = [
  ["image/webp", 0.9],
  ["image/png"],
];

export type AvatarFileResult = { avatar: ExpertIdentityAvatar } | { problem: "tooLarge" | "unreadable" };

/** The largest centered square inside an image, as the region to copy. */
export function centerSquare(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** The first encoding the identity layer stores, or `undefined` when none fits. */
export function encodeAvatar(encode: (mime: string, quality?: number) => string): ExpertIdentityAvatar | undefined {
  for (const [mime, quality] of ENCODINGS) {
    const avatar = avatarFromDataUrl(encode(mime, quality));
    if (avatar !== undefined) return avatar;
  }
  return undefined;
}

/**
 * Crop a picked image to a centered square and re-encode it small enough to store.
 * @param file Image the user picked.
 * @returns The avatar, or why the image cannot be used.
 */
export async function avatarFromFile(file: Blob): Promise<AvatarFileResult> {
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return { problem: "tooLarge" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { problem: "unreadable" };
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIDE;
    canvas.height = AVATAR_SIDE;
    const context = canvas.getContext("2d");
    if (context === null || bitmap.width === 0 || bitmap.height === 0) return { problem: "unreadable" };
    const { x, y, side } = centerSquare(bitmap.width, bitmap.height);
    context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
    const avatar = encodeAvatar((mime, quality) => canvas.toDataURL(mime, quality));
    return avatar === undefined ? { problem: "unreadable" } : { avatar };
  } catch {
    return { problem: "unreadable" };
  } finally {
    bitmap.close();
  }
}
