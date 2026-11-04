import { reducedMotion } from "./ui.js";

/** Plays the opening sequence. Resolves when the splash starts leaving so the next screen can cross-fade in. */
export function runSplash() {
  const el = document.getElementById("splash");
  const skip = document.getElementById("splash-skip");
  const reduced = reducedMotion();
  const hold = reduced ? 1400 : 2700;
  const fade = reduced ? 250 : 500;

  return new Promise((resolve) => {
    let done = false;
    const finish = (fast) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      if (fast) el.classList.add("splash--fast");
      el.classList.add("splash--exit");
      setTimeout(() => el.remove(), fast ? 250 : fade);
      resolve();
    };
    const onKey = (e) => { if (e.key === "Escape") finish(true); };
    const timer = setTimeout(() => finish(false), hold);
    skip.addEventListener("click", () => finish(true), { once: true });
    document.addEventListener("keydown", onKey);
  });
}
