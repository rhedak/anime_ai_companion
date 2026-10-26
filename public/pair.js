// The page a phone opens from the pairing link (`/pair?e=<code>`): it uses the code once, shows four digits that the computer shows too, and waits for the yes there.
// Nothing here is secret: the code is in the address and goes away from it at once, and what is handed out afterwards is a cookie the page never reads.
const text = document.getElementById("text");
const digits = document.getElementById("digits");
const problem = document.getElementById("problem");

const code = new URLSearchParams(location.search).get("e");
history.replaceState(null, "", location.pathname); // the code is used up by the first visit: it does not stay in the address or the history

/** @param {string} message */
function fail(message) {
  digits.textContent = "";
  text.textContent = "This phone was not connected.";
  problem.textContent = message;
}

async function start() {
  if (!code) return fail("Open the link or the QR code that /phone shows on the computer.");
  let reply;
  try {
    reply = await fetch("pair/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), cache: "no-store" });
  } catch {
    return fail("The computer could not be reached. Is phone access still on?");
  }
  const body = await reply.json().catch(() => ({}));
  if (!reply.ok) return fail(body.error || "That did not work.");
  digits.textContent = body.code;
  text.textContent = "On the computer, check that it shows the same four digits, then press Allow.";
  wait(body.id, Date.now() + (body.seconds ?? 120) * 1000 + 5000);
}

/** @param {string} id @param {number} until */
async function wait(id, until) {
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    let state = "";
    try {
      state = (await (await fetch(`pair/status?id=${encodeURIComponent(id)}`, { cache: "no-store" })).json()).state;
    } catch {
      continue; // a moment without Wi-Fi: try again
    }
    if (state === "allowed") {
      text.textContent = "Allowed. Opening her…";
      return location.replace("./");
    }
    if (state === "denied") return fail("The computer said no.");
    if (state === "expired") break;
  }
  fail("Nobody allowed it in time. Type /phone on the computer for a new link.");
}

void start();
