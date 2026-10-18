// Speaking instead of typing, through the browser's own speech recognition. Off until the user agrees: in Chrome and Edge
// the audio is sent to the browser maker's servers to be turned into text, and Safari uses Apple's, so this is the one place
// where a recording leaves the machine. This app's server never receives audio; the words land in the message box for review.

/** What to tell the user when recognition fails, by the browser's error code. */
export function dictationProblem(code) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked: allow it for this page in the browser's site settings. (Browsers only allow it on localhost or HTTPS, so it does not work from a phone over plain http.)";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs the internet in this browser (it is done by a server), and could not reach it.";
    case "language-not-supported":
      return "This browser cannot recognise speech in this language.";
    case "no-speech":
      return "I did not hear anything.";
    default:
      return null; // "aborted" (we stopped it) and anything unknown: nothing to say
  }
}

/** Puts what was said after whatever was already in the box. */
export function joinDictation(before, spoken) {
  const said = String(spoken).trim();
  if (!said) return before;
  return before && !/\s$/.test(before) ? `${before} ${said}` : before + said;
}

/** Who gets the audio, for the sentence the user agrees to. */
export function dictationVendor(userAgent = "") {
  if (/Edg\//.test(userAgent)) return "Microsoft";
  if (/Chrome\//.test(userAgent)) return "Google";
  if (/Safari\//.test(userAgent)) return "Apple";
  return "the browser's maker";
}

/**
 * `onText(text, final)` gets everything said since start() (what is still being worked out included); `onState(listening)` follows
 * the microphone; `onProblem(message)` explains a failure. `env` is only for tests.
 */
export function createDictation({ onText, onState, onProblem, language = () => "en", env = globalThis }) {
  const Recognition = env.SpeechRecognition ?? env.webkitSpeechRecognition;
  // Insecure pages (a phone over plain http) are refused by browsers anyway; do not offer a button that cannot work.
  // The desktop shell (Electron) has the API but no speech service behind it (that needs a Google key of its own), so it only ever fails with "network".
  const inElectron = /Electron\//.test(env.navigator?.userAgent ?? "");
  const supported = Boolean(Recognition) && env.isSecureContext !== false && !inElectron;
  let listening = false;
  let current = null;
  const stored = () => {
    try {
      return env.localStorage?.getItem("dictation-ok") === "yes";
    } catch {
      return false;
    }
  };
  let consented = stored();

  function start() {
    if (!supported || listening) return;
    const recognition = new Recognition();
    recognition.lang = language();
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let text = "";
      let final = true;
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
        if (!event.results[i].isFinal) final = false;
      }
      onText(text, final);
    };
    recognition.onerror = (event) => {
      const message = dictationProblem(event.error);
      if (message) onProblem(message);
    };
    recognition.onend = () => {
      if (current === recognition) current = null;
      listening = false;
      onState(false);
    };
    current = recognition;
    listening = true;
    onState(true);
    try {
      recognition.start();
    } catch (err) {
      current = null;
      listening = false;
      onState(false);
      onProblem("Could not start the microphone: " + (err?.message ?? err));
    }
  }

  function stop() {
    current?.stop(); // lets it finish what it has heard; onend follows
  }

  return {
    supported,
    /** In the desktop shell: show the button, but send the user to a real browser instead of listening. */
    needsBrowser: inElectron,
    get listening() {
      return listening;
    },
    get consented() {
      return consented;
    },
    consent() {
      consented = true;
      try {
        env.localStorage?.setItem("dictation-ok", "yes");
      } catch {
        // storage blocked: asked again next time
      }
    },
    toggle() {
      if (listening) stop();
      else start();
    },
    start,
    stop,
  };
}
