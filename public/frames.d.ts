export const GESTURES: Record<string, Record<string, number>[]>;
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
): { op: "frames"; character: Record<string, any>; face: Record<string, number>; mouth: number[]; poses: Record<string, number>[] } | null;
