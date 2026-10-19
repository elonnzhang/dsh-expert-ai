import { EXPERT_AVATAR_MIMES, MAX_EXPERT_AVATAR_LENGTH } from "./constants.js";
import type { ExpertIdentityAvatar, ExpertIdentityAvatarMime } from "./types.js";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_MARKER = ";base64,";

function isAvatarMime(value: string): value is ExpertIdentityAvatarMime {
  return (EXPERT_AVATAR_MIMES as readonly string[]).includes(value);
}

/** The `data:` URL of an avatar; the Bot runtime stores and renders this string. */
export function avatarDataUrl(avatar: ExpertIdentityAvatar): string {
  return `data:${avatar.mime}${BASE64_MARKER}${avatar.data}`;
}

/** Why an avatar cannot be stored, or `undefined` when it can. The message never contains the image. */
export function avatarProblem(avatar: ExpertIdentityAvatar): string | undefined {
  if (!isAvatarMime(avatar.mime)) return `image type must be one of ${EXPERT_AVATAR_MIMES.join(", ")}`;
  if (!BASE64.test(avatar.data) || avatar.data.length % 4 !== 0) return "image data must be base64";
  if (avatarDataUrl(avatar).length > MAX_EXPERT_AVATAR_LENGTH)
    return `image must fit in ${String(MAX_EXPERT_AVATAR_LENGTH)} characters as a data URL`;
  return undefined;
}

/** Split a `data:` URL into an avatar, or `undefined` when the identity layer would not store it. */
export function avatarFromDataUrl(url: string): ExpertIdentityAvatar | undefined {
  const marker = url.indexOf(BASE64_MARKER);
  if (!url.startsWith("data:") || marker < 0) return undefined;
  const mime = url.slice("data:".length, marker);
  if (!isAvatarMime(mime)) return undefined;
  const avatar = { mime, data: url.slice(marker + BASE64_MARKER.length) };
  return avatarProblem(avatar) === undefined ? avatar : undefined;
}
