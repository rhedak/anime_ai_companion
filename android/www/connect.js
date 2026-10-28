// The connect screen: the app's own page, the only one that has the native plugins.
// It never shows the computer's page itself; the native side loads that after the address is checked.
(function () {
  const plugins = window.Capacitor && window.Capacitor.Plugins;
  const Computer = plugins && plugins.Computer;
  const Scanner = plugins && plugins.BarcodeScanner;
  const status = document.getElementById("status");
  const saved = document.getElementById("saved");
  const resume = document.getElementById("resume");
  const busy = (on) => document.querySelectorAll("button, input").forEach((el) => (el.disabled = on));

  function say(text, isError) {
    status.textContent = text;
    status.className = isError ? "error" : "";
  }

  async function connect(address) {
    busy(true);
    say("Connecting…");
    try {
      await Computer.open({ url: address });
      // The WebView now shows the computer's page; nothing more to do here.
    } catch (err) {
      busy(false);
      say(err && err.message ? err.message : "That did not connect.", true);
    }
  }

  async function showSaved() {
    try {
      const { address } = await Computer.saved();
      saved.hidden = !address;
      if (address) {
        resume.textContent = "Connect to " + address;
        resume.onclick = () => connect("http://" + address + "/");
      }
    } catch (err) {
      say(err.message, true);
    }
  }

  document.getElementById("typed").addEventListener("submit", (event) => {
    event.preventDefault();
    connect(document.getElementById("address").value);
  });

  document.getElementById("forget").addEventListener("click", async () => {
    try {
      await Computer.forget();
      saved.hidden = true;
      say("Forgotten. Pair again the next time you connect.");
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById("scan").addEventListener("click", async () => {
    busy(true);
    say("Opening the camera…");
    try {
      const available = await Scanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available.available) {
        say("Installing the scanner once. This needs the internet.");
        await Scanner.installGoogleBarcodeScannerModule();
      }
      const { barcodes } = await Scanner.scan({ formats: ["QR_CODE"] });
      const value = barcodes && barcodes[0] && barcodes[0].rawValue;
      if (!value) {
        busy(false);
        say("No code was read. Try again.", true);
        return;
      }
      await connect(value);
    } catch (err) {
      busy(false);
      say("The scan did not finish: " + (err && err.message ? err.message : "try again"), true);
    }
  });

  if (!Computer) {
    say("This page needs the Android app. Open the app to connect.", true);
    busy(true);
    return;
  }
  showSaved();
})();
