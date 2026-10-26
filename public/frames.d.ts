export const GESTURES: Record<string, Record<string, number>[]>;
export const ADULT_GESTURES: Record<string, Record<string, number | string>[]>;
export const CUT_FACES: Record<string, Record<string, Record<string, number | boolean>>>;
export const CUT_TALK: Record<string, Record<string, number[]>>;
export function gesturePoses(character: Record<string, any> | null | undefined, gesture: string): Record<string, number | string>[] | undefined;
export function gestureView(character: Record<string, any> | null | undefined, gesture: string): string | null;
export function framesRequest(
  emotions: Record<string, Record<string, number>>,
  character: Record<string, any>,
  emotion: string,
): { op: "frames"; character: Record<string, any>; face: Record<string, number>; mouth: number[]; eyes_shut?: true };
export function gestureRequest(
  emotions: Record<string, Record<string, number>>,
  character: Record<string, any>,
  emotion: string,
  gesture: string,
): { op: "frames"; character: Record<string, any>; face: Record<string, number | boolean>; mouth: number[]; poses: Record<string, number | string>[]; eyes_shut?: true } | null;
