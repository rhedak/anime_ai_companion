export const GESTURES: Record<string, Record<string, number>[]>;
export const ADULT_GESTURES: Record<string, Record<string, number | string>[]>;
export function gesturePoses(character: Record<string, any> | null | undefined, gesture: string): Record<string, number | string>[] | undefined;
export function gestureView(character: Record<string, any> | null | undefined, gesture: string): string | null;
export function framesRequest(
  emotions: Record<string, Record<string, number>>,
  character: Record<string, any>,
  emotion: string,
): { op: "frames"; character: Record<string, any>; face: Record<string, number>; mouth: number[] };
export function gestureRequest(
  emotions: Record<string, Record<string, number>>,
  character: Record<string, any>,
  emotion: string,
  gesture: string,
): { op: "frames"; character: Record<string, any>; face: Record<string, number>; mouth: number[]; poses: Record<string, number | string>[] } | null;
