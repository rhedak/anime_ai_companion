/** Shapes shared by the pieces of the server. */

/** Tells the user something in their chat log only (not stored, not sent to other tabs). */
export type Say = (text: string) => void;

/** Sends one message to every connected page. */
export type Broadcast = (msg: unknown) => void;
