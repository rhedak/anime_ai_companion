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

export const RATES = [0.8, 0.9, 1, 1.05, 1.2, 1.4];
const DEFAULT_RATE = 1.05;

/** Clamps a stored or typed speed to what browsers accept, falling back to the default. */
export function cleanRate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : DEFAULT_RATE;
}

/**
 * The browser's voices as menu entries, the ones in the page's language first. A voice that is not
 * `localService` is synthesised by a server (desktop Chrome's "Google …" voices), so it says so: the text
 * she speaks is sent there.
 */
export function describeVoices(voices, language = "en") {
  const base = String(language).toLowerCase().split("-")[0];
  const rank = (v) => (String(v.lang).toLowerCase().split(/[-_]/)[0] === base ? 0 : 1);
  return [...voices]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((v) => ({
      uri: v.voiceURI,
      local: v.localService !== false,
      label: `${v.name} (${v.lang})${v.localService === false ? " · online" : ""}`,
    }));
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
  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const store = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore: the choice just lasts until the page closes
    }
  };
  let voiceURI = stored("voice-uri") || "";
  let rate = cleanRate(stored("voice-rate"));
  let queued = 0;

  const done = () => {
    queued = Math.max(0, queued - 1);
    if (queued === 0) onSpeaking(false);
  };

  // Some browsers drop the "end" event; never leave her mouth moving forever.
  const watchdog = setInterval(() => {
    if (queued > 0 && !synth.speaking && !synth.pending) {
      queued = 0;
      onSpeaking(false);
    }
  }, 500);
  watchdog.unref?.(); // a Node test must not be kept alive by it; browsers return a number

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
    get rate() {
      return rate;
    },
    setRate(value) {
      rate = cleanRate(value);
      store("voice-rate", String(rate));
    },
    get voiceURI() {
      return voiceURI;
    },
    /** "" means the browser's own default voice. */
    setVoice(uri) {
      voiceURI = uri || "";
      store("voice-uri", voiceURI);
    },
    /** The voices to offer. They load late in some browsers: `onChange` fires again when they arrive. */
    voices(language) {
      return supported ? describeVoices(synth.getVoices(), language) : [];
    },
    onVoicesChanged(callback) {
      if (supported) synth.addEventListener?.("voiceschanged", callback);
    },
    speak(text) {
      const spoken = speechText(text);
      if (!enabled || !spoken) return;
      try {
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.rate = rate;
        const chosen = voiceURI && synth.getVoices().find((v) => v.voiceURI === voiceURI);
        if (chosen) {
          utterance.voice = chosen;
          utterance.lang = chosen.lang;
        }
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
