// Injected into every page the trailer driver opens: captions, a small tag, and a ripple where a tap lands.
(() => {
  if (window.__overlay) return;
  window.__overlay = true;

  // The /phone card shows this computer's real addresses and its name. The video never does: when the trailer
  // driver has set window.__fakePhone, the page is handed that instead (its links, and the QR for the first).
  const RealSocket = window.WebSocket;
  window.WebSocket = class extends RealSocket {
    set onmessage(handler) {
      super.onmessage = handler && ((event) => {
        let data = event.data;
        try {
          const msg = JSON.parse(data);
          if (msg.type === "phone" && window.__fakePhone) data = JSON.stringify({ ...msg, links: window.__fakePhone.links, qr: window.__fakePhone.qr });
        } catch {}
        return handler.call(this, data === event.data ? event : new MessageEvent("message", { data }));
      });
    }
    get onmessage() {
      return super.onmessage;
    }
  };
  const css = document.createElement("style");
  css.textContent = `
    #meter { display: none !important; }
    #__cap { position: fixed; left: 50%; bottom: 200px; transform: translateX(-50%); z-index: 99998; width: max-content; max-width: 88vw; text-align: center;
      font: 700 21px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; padding: 9px 16px; border-radius: 16px;
      background: rgba(18, 12, 38, .82); box-shadow: 0 6px 24px rgba(0,0,0,.45); opacity: 0; transition: opacity .25s; pointer-events: none; }
    #__cap.on { opacity: 1; }
    #__tag { position: fixed; left: 0; right: 0; top: 24px; z-index: 99998; text-align: center; font: 600 11px/1 system-ui, sans-serif; color: rgba(255,255,255,.88);
      text-shadow: 0 0 3px #000, 0 1px 2px #000; pointer-events: none; }
    .__ripple { position: fixed; z-index: 99999; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(255,255,255,.55);
      border: 2px solid rgba(255,255,255,.9); pointer-events: none; animation: __r .55s ease-out forwards; }
    @keyframes __r { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }

    #__inset { position: fixed; left: 7vw; right: 7vw; top: 96px; z-index: 99998; border-radius: 14px; overflow: hidden; background: #111; box-shadow: 0 10px 34px rgba(0,0,0,.6);
      border: 2px solid rgba(255,255,255,.85); opacity: 0; transform: translateY(-8px); transition: opacity .3s, transform .3s; pointer-events: none; }
    #__inset.on { opacity: 1; transform: none; }
    #__inset img { display: block; width: 100%; }
    #__inset .label { position: absolute; left: 8px; top: 8px; padding: 3px 9px; border-radius: 9px; background: rgba(18,12,38,.85); color: #fff; font: 700 12px system-ui, sans-serif; }
    #__scan { position: fixed; z-index: 99998; pointer-events: none; border: 3px solid #7dffb0; border-radius: 12px; box-shadow: 0 0 18px rgba(125,255,176,.7); opacity: 0; transition: opacity .25s; overflow: hidden; }
    #__scan.on { opacity: 1; }
    #__scan i { position: absolute; left: 0; right: 0; height: 3px; background: #7dffb0; box-shadow: 0 0 10px #7dffb0; animation: __sweep 1.1s ease-in-out infinite alternate; }
    @keyframes __sweep { from { top: 0; } to { top: calc(100% - 3px); } }
    .msg.sys:has(svg) a { filter: blur(5px); }
    #__end { position: fixed; inset: 0; z-index: 99997; display: flex; flex-direction: column; justify-content: flex-end; pointer-events: none;
      background: linear-gradient(to bottom, rgba(10,6,24,0) 0%, rgba(10,6,24,0) 50%, rgba(10,6,24,.95) 63%); opacity: 0; transition: opacity .6s; }
    #__end.on { opacity: 1; }
    #__end .card { padding: 0 22px 26px; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; }
    #__end h1 { margin: 0 0 6px; font: 800 30px/1.1 system-ui, sans-serif; }
    #__end .sub { font-size: 15px; line-height: 1.35; color: #e8e2ff; margin-bottom: 12px; }
    #__end .url { font: 700 12.5px/1.2 ui-monospace, Menlo, monospace; color: #ffd7a8; margin-bottom: 14px; }
    #__end .credits { font-size: 9.5px; line-height: 1.4; color: rgba(255,255,255,.72); }
  `;
  document.addEventListener("DOMContentLoaded", () => document.head.append(css));
  if (document.head) document.head.append(css);
  let timer = null;
  const el = (id) => document.getElementById(id) ?? document.body.appendChild(Object.assign(document.createElement("div"), { id }));
  window.__caption = (text, ms) => {
    const cap = el("__cap");
    clearTimeout(timer);
    if (!text) return void cap.classList.remove("on");
    cap.textContent = text;
    const composer = document.querySelector(".composer");
    if (composer) cap.style.bottom = `${Math.round(innerHeight - composer.getBoundingClientRect().top + 12)}px`;
    cap.classList.add("on");
    if (ms) timer = setTimeout(() => cap.classList.remove("on"), ms);
  };
  window.__tag = (text) => { el("__tag").textContent = text ?? ""; };
  window.__ripple = (x, y) => {
    const r = Object.assign(document.createElement("div"), { className: "__ripple" });
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    setTimeout(() => r.remove(), 700);
  };

  window.__inset = (src, label, ms) => {
    const box = el("__inset");
    box.innerHTML = `<img src="${src}"><div class="label">${label}</div>`;
    requestAnimationFrame(() => box.classList.add("on"));
    if (ms) setTimeout(() => box.classList.remove("on"), ms);
  };
  window.__scan = (x, y, w, h, ms) => {
    const box = el("__scan");
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    box.innerHTML = "<i></i>";
    requestAnimationFrame(() => box.classList.add("on"));
    if (ms) setTimeout(() => box.classList.remove("on"), ms);
  };
  window.__end = (html) => {
    const e = el("__end");
    e.innerHTML = `<div class="card">${html}</div>`;
    requestAnimationFrame(() => e.classList.add("on"));
  };
})();
