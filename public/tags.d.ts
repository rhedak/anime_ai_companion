export const AVATAR_TAG: RegExp;
export function parseAvatarTag(body: string): Record<string, string>;
export const OUTFIT_TAG: RegExp;
export function findOutfitTags(text: string): string[];
export function findAvatarTags(text: string): Record<string, string>[];
