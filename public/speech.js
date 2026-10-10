// Spoken replies through the browser's own speech synthesis (local voices, nothing is uploaded).

/** Text as it should be read aloud: no markdown, code blocks or raw links. */
export function speechText(text) {
  return text
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[*_#>~|]+/g, " ")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits off the complete sentences at the start of `text`. A sentence is only
 * complete once whitespace follows its punctuation, so "3.14" and a half-streamed
 * "Hello wor" are left in `rest`.
 */
export function takeSentences(text) {
  const boundary = /[.!?…]+["')\]]*\s+/g;
  let end = 0;
  for (let m; (m = boundary.exec(text)); ) end = m.index + m[0].length;
  return { ready: text.slice(0, end), rest: text.slice(end) };
}

export function createVoice(onSpeaking) {
  const synth = globalThis.speechSynthesis;
  const supported = Boolean(synth) && typeof SpeechSynthesisUtterance !== "undefined";
  let enabled = false;
  try {
    enabled = supported && localStorage.getItem("voice") === "on";
  } catch {
    // storage blocked: voice simply starts off
  }
  let queued = 0;

  const done = () => {
    queued = Math.max(0, queued - 1);
    if (queued === 0) onSpeaking(false);
  };

  // Some browsers drop the "end" event; never leave her mouth moving forever.
  setInterval(() => {
    if (queued > 0 && !synth.speaking && !synth.pending) {
      queued = 0;
      onSpeaking(false);
    }
  }, 500);

  return {
    supported,
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = supported && on;
      try {
        localStorage.setItem("voice", enabled ? "on" : "off");
      } catch {
        // ignore
      }
      if (!enabled) this.cancel();
    },
    speak(text) {
      const spoken = speechText(text);
      if (!enabled || !spoken) return;
      try {
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.rate = 1.05;
        utterance.onend = utterance.onerror = done;
        queued++;
        onSpeaking(true);
        synth.speak(utterance);
      } catch {
        done(); // a failing speech engine must never break the chat
      }
    },
    cancel() {
      if (!supported) return;
      synth.cancel();
      queued = 0;
      onSpeaking(false);
    },
  };
}
