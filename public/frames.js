// What it takes to draw her, as requests for the renderer (src/render-ops.ts). One source for the server (src/avatar.ts) and the
// browser demo (demo/local-socket.js): they ask for exactly the same frames, because they run this same code.

/** Arm poses to alternate between for a gesture, in degrees from the body (about 115 to 155 reads as a raised arm). */
export const GESTURES = {
  wave: [{ right_arm_out: 128 }, { right_arm_out: 152 }],
  cheer: [
    { right_arm_out: 125, left_arm_out: 125 },
    { right_arm_out: 150, left_arm_out: 150 },
  ],
};

const known = (emotions, emotion) => (emotion in emotions ? emotion : "neutral");

/** The request for four mouth openings (for talking) and a blink, in this emotion's face. */
export function framesRequest(emotions, character, emotion) {
  const face = emotions[known(emotions, emotion)];
  const rest = face.mouth_open ?? character.face?.mouth_open ?? 0;
  const mouth = [rest, Math.max(rest, 0.3), Math.max(rest, 0.55), Math.max(rest, 0.85)];
  return { op: "frames", character, face, mouth };
}

/** The request for the two poses of a gesture, or null for an unknown gesture. */
export function gestureRequest(emotions, character, emotion, gesture) {
  const poses = GESTURES[gesture];
  if (!poses) return null;
  const face = emotions[known(emotions, emotion)];
  const rest = face.mouth_open ?? character.face?.mouth_open ?? 0;
  return { op: "frames", character, face, mouth: [rest], poses };
}
