/**
 * True when a key press belongs to an input method (Japanese, Chinese, Korean typing) that is still composing
 * text: Enter then confirms the conversion and must not send the message. Safari reports the Enter that ends a
 * composition after `isComposing` has already gone false, but with keyCode 229.
 */
export function composing(event) {
  return Boolean(event.isComposing) || event.keyCode === 229;
}
