// The menu button on a narrow screen, and copy buttons on code blocks. Nothing else; the pages work without it.
const body = document.body;
const menu = document.querySelector(".menu");
menu?.addEventListener("click", () => {
  const open = body.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});
document.querySelector(".side")?.addEventListener("click", (e) => {
  if (e.target.closest("a")) {
    body.classList.remove("open");
    menu?.setAttribute("aria-expanded", "false");
  }
});
for (const button of document.querySelectorAll(".copy")) {
  button.addEventListener("click", async () => {
    const text = button.parentElement.querySelector("code").textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector("code"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      button.textContent = "Selected";
    }
    setTimeout(() => (button.textContent = "Copy"), 1600);
  });
}
