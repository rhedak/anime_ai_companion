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
  // "。" and the full-width "！" "？" end a sentence without any space after them
  const boundary = /(?:[.!?…]+["')\]]*\s+|[。！？]+[」』）)"']*)/g;
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
      lang: v.lang,
      local: v.localService !== false,
      label: `${v.name} (${v.lang})${v.localService === false ? " · online" : ""}`,
    }));
}

const SAMPLES = {
  en: "Hi! This is how I sound.",
  ja: "こんにちは! 私の声はこんな感じです。",
  de: "Hallo! So klinge ich.",
  fr: "Salut ! Voilà comment je parle.",
  es: "¡Hola! Así es como sueno.",
  zh: "你好!我的声音是这样的。",
  ko: "안녕하세요! 제 목소리는 이래요.",
};

/** A short sentence in the voice's own language, so a Japanese voice is tried on Japanese, not on English. */
export function sampleText(lang) {
  return SAMPLES[String(lang).toLowerCase().split(/[-_]/)[0]] ?? SAMPLES.en;
}

export function createVoice(onSpeaking, onProblem = () => {}) {
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
  let generation = 0; // bumped by cancel(): what was waiting to be spoken is dropped
  let cancelledAt = -Infinity;
  const reported = new Set();
  const problem = (key, message) => {
    if (reported.has(key)) return;
    reported.add(key);
    onProblem(message);
  };

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
    /**
     * Calls `callback` now and whenever the list of voices changes. Browsers load voices late, and some (Chrome
     * on Android) never say so, so the list is also looked at for a few seconds after the page opens.
     */
    watchVoices(callback) {
      if (!supported) return;
      synth.addEventListener?.("voiceschanged", callback);
      let last = -1;
      let tries = 0;
      const check = () => {
        const n = synth.getVoices().length;
        if (n !== last) {
          last = n;
          callback();
        }
        if (++tries >= 40) clearInterval(timer);
      };
      const timer = setInterval(check, 250);
      timer.unref?.();
      check();
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
        } else if (voiceURI) {
          problem(`missing:${voiceURI}`, `The voice "${voiceURI}" is not available in this browser, so she uses the default voice.`);
        }
        let started = false;
        utterance.onstart = () => (started = true);
        utterance.onend = done;
        utterance.onerror = (e) => {
          // "canceled" and "interrupted" are just her being stopped; anything else is worth knowing.
          if (e?.error && !["canceled", "interrupted"].includes(e.error)) {
            problem(`error:${e.error}`, `The speech engine could not speak (${e.error}). Try another voice in the Voice menu.`);
          }
          done();
        };
        queued++;
        onSpeaking(true);
        const mine = generation;
        const go = () => {
          if (mine !== generation) return; // cancelled while waiting
          try {
            synth.speak(utterance);
          } catch {
            done();
            return;
          }
          // Accepted but never started: typically a voice that is listed but not installed. Say so.
          const check = setTimeout(() => {
            if (!started && mine === generation && !synth.speaking) {
              problem(
                `silent:${voiceURI}`,
                `The browser did not start speaking${chosen ? ` with "${chosen.name}"` : ""}. The voice may not be fully installed on this device (the system's speech settings can download it); try another voice.`,
              );
            }
          }, 4000);
          check.unref?.();
        };
        // Chrome drops a speak() that follows cancel() at once, so give the cancel a moment.
        const wait = 150 - (Date.now() - cancelledAt);
        if (wait > 0) setTimeout(go, wait);
        else go();
      } catch {
        done(); // a failing speech engine must never break the chat
      }
    },
    cancel() {
      if (!supported) return;
      synth.cancel();
      generation++;
      cancelledAt = Date.now();
      queued = 0;
      onSpeaking(false);
    },
  };
}
