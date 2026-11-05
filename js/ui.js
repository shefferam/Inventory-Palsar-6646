export const EMBLEM_SRC = "assets/Palsar.jpeg";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const ICONS = {
  alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- Light / dark theme ----------

const THEME_KEY = "palsar.theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#fbfbf7" : "#0b0d0b");
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const label = theme === "light" ? "מעבר לתצוגה כהה" : "מעבר לתצוגה בהירה";
  btn.innerHTML = icon(theme === "light" ? "moon" : "sun", "btn__icon");
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

/** Saved choice, otherwise the device setting. */
export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

export function toast(message, tone = "warn", ms = 5000) {
  const el = document.createElement("div");
  el.className = `toast toast--${tone}`;
  el.textContent = message;
  document.getElementById("toasts").append(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, ms);
}

/** Resolves true only if the unit emblem file actually loads; never substitutes a fallback image. */
export function verifyEmblem() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = EMBLEM_SRC;
  });
}

export function disableEmblem() {
  document.documentElement.classList.add("no-emblem");
  document.getElementById("favicon")?.remove();
  document.getElementById("touch-icon")?.remove();
  console.error(`[Palsar] Unit emblem not found or unreadable: ${EMBLEM_SRC}`);
  toast("סמל היחידה (assets/Palsar.jpeg) לא נמצא או אינו קריא – המערכת תוצג ללא הסמל.", "danger", 8000);
}
