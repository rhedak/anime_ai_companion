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

/** The drawn bodies with the adult woman's proportions (the creator's `body` field): their arms bend at the elbow, and a raised hand lies well out to the side or above the picture's close-up. */
const ADULT_BODIES = ["adult_female"];

/**
 * The same gestures for the adult body (the creator's 0.5.1 added `right_elbow` and `left_elbow`, and a fist is `grip_style: "fist"`). The wave is the picture packs' own: the upper arm held in, the forearm
 * tilted out and then upright, the open palm beside the head. The cheer pumps both fists at the shoulders, then throws them up. The chibi's straight swing above would barely move her.
 */
export const ADULT_GESTURES = {
  wave: [
    { right_arm_out: 6, right_elbow: 148 },
    { right_arm_out: 6, right_elbow: 155 },
  ],
  cheer: [
    { right_arm_out: 16, left_arm_out: 16, right_elbow: 148, left_elbow: 148, grip_style: "fist" },
    { right_arm_out: 150, left_arm_out: 150, right_elbow: 0, left_elbow: 0, grip_style: "fist" },
  ],
};

/** The poses of a gesture for this character's body, or undefined for an unknown gesture. */
export const gesturePoses = (character, gesture) => (ADULT_BODIES.includes(character?.body) ? ADULT_GESTURES : GESTURES)[gesture];

/**
 * The close-up's frame is made for a head and torso (`55 0 290 330`), which cuts off the thrown-up hands of the adult cheer (they reach out to x 25 and 375 and up to y -22). The viewBox to show that
 * gesture in instead, or null for the usual one.
 */
export function gestureView(character, gesture) {
  return ADULT_BODIES.includes(character?.body) && gesture === "cheer" ? "15 -30 370 360" : null;
}

const known = (emotions, emotion) => (emotion in emotions ? emotion : "neutral");

/**
 * Faces that a character's drawing wants tuned, by the creator's `hairstyle` (the head cut a character is drawn with decides the face's proportions), laid over `emotions.json` for that emotion.
 * The two adult cuts (the creator after 0.5.1 draws both faces straight and symmetric) share an open-smile happy: the shared one, a small mouth 0.3 open, read as a smirk on them.
 */
const ADULT_HAPPY = { mouth_width: 1.5, mouth_curve: 1.5, mouth_open: 0.6, blush: 1.3, eye_openness: 0.8, brow_tilt: 0 };
/**
 * Risa's happy is the reference's laugh: eyes shut in a smile and the creator's D mouth (0.7.1), as wide as the reference's (1.55) and as shallow (0.9 open, at rest).
 * `eyes_closed` is not a face field of the request (the frames op keeps eyes open but for the blink): `framesRequest` turns it into `eyes_shut`, which the op honours, so her happy has no open-eyed frames.
 */
const RISA_HAPPY = { mouth_width: 1.55, mouth_curve: 1.5, mouth_open: 0.9, blush: 1.3, eyes_closed: true, brow_tilt: 0 };
export const CUT_FACES = {
  long_straight_fringed: { happy: RISA_HAPPY }, // Risa
  swept_ponytail: { happy: ADULT_HAPPY }, // Franzi
};

/**
 * Talking frames (the openings after the resting one) where the shared rule, never below the rest, would leave a laugh that does not move: Risa's happy rests at 0.9, so
 * her talking mouth narrows and opens again around it.
 */
export const CUT_TALK = {
  long_straight_fringed: { happy: [0.4, 0.65, 0.9] },
};

/** The face of an emotion for this character: `emotions.json`'s, with the character's own tuning over it. */
const faceOf = (emotions, character, emotion) => {
  const name = known(emotions, emotion);
  return { ...emotions[name], ...(CUT_FACES[character?.hairstyle]?.[name] ?? {}) };
};

/** The request for four mouth openings (for talking) and a blink, in this emotion's face. */
export function framesRequest(emotions, character, emotion) {
  const { eyes_closed: shut, ...face } = faceOf(emotions, character, emotion);
  const rest = face.mouth_open ?? character.face?.mouth_open ?? 0;
  const talk = CUT_TALK[character?.hairstyle]?.[known(emotions, emotion)] ?? [Math.max(rest, 0.3), Math.max(rest, 0.55), Math.max(rest, 0.85)];
  const mouth = [rest, ...talk];
  return shut ? { op: "frames", character, face, mouth, eyes_shut: true } : { op: "frames", character, face, mouth };
}

/** The request for the two poses of a gesture, or null for an unknown gesture. */
export function gestureRequest(emotions, character, emotion, gesture) {
  const poses = gesturePoses(character, gesture);
  if (!poses) return null;
  const { eyes_closed: shut, ...face } = faceOf(emotions, character, emotion);
  const rest = face.mouth_open ?? character.face?.mouth_open ?? 0;
  return shut ? { op: "frames", character, face, mouth: [rest], poses, eyes_shut: true } : { op: "frames", character, face, mouth: [rest], poses };
}
