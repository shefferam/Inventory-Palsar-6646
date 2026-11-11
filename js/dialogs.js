import { esc, icon, reducedMotion, toast } from "./ui.js";

export function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains("is-closing")) return;
  if (reducedMotion()) return dlg.close();
  dlg.classList.add("is-closing");
  const done = () => {
    clearTimeout(timer);
    dlg.removeEventListener("animationend", onEnd);
    dlg.classList.remove("is-closing");
    dlg.close();
  };
  // Children's animations bubble up too; only the dialog's own exit animation counts.
  const onEnd = (e) => { if (e.target === dlg) done(); };
  // Fallback in case the exit animation never runs (e.g. overridden on small screens).
  const timer = setTimeout(done, 400);
  dlg.addEventListener("animationend", onEnd);
}

/** Wires backdrop/Esc/[data-close] closing; `onClick` handles any other clicks inside the dialog. */
export function bindDialog(dlg, onClick) {
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) return closeDialog(dlg);
    onClick?.(e);
  };
  dlg.oncancel = (e) => { e.preventDefault(); closeDialog(dlg); };
  // Not every browser/embedding raises "cancel" for Escape, so handle the key directly as well.
  dlg.onkeydown = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeDialog(dlg);
  };
}

/**
 * Small modal form. `body` is trusted HTML built by the caller (values escaped).
 * `onSubmit(formData)` may throw to show an inline error, or return a success toast message.
 */
export function openForm({ title, body, submit, onSubmit, danger = false, wide = false }) {
  const dlg = document.getElementById("form-dialog");
  dlg.classList.toggle("form-dialog--wide", wide);
  dlg.innerHTML = `
    <form class="form" novalidate>
      <header class="form__head">
        <h2>${esc(title)}</h2>
        <button type="button" class="btn btn--icon" data-close aria-label="סגירה">${icon("close", "btn__icon")}</button>
      </header>
      <div class="form__body">${body}</div>
      <p class="form__error" role="alert" hidden></p>
      <footer class="form__foot">
        <button type="button" class="btn btn--ghost" data-close>ביטול</button>
        <button type="submit" class="btn ${danger ? "btn--danger" : "btn--primary"}">${esc(submit)}</button>
      </footer>
    </form>`;
  const form = dlg.querySelector("form");
  const error = dlg.querySelector(".form__error");
  const button = dlg.querySelector('[type="submit"]');

  form.onsubmit = async (e) => {
    e.preventDefault();
    error.hidden = true;
    button.disabled = true;
    try {
      const message = await onSubmit(new FormData(form), form);
      closeDialog(dlg);
      if (message) toast(message, "ok", 3500);
    } catch (err) {
      error.textContent = err?.message || "הפעולה נכשלה";
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  };

  // Select the current number on focus so typing replaces it (e.g. the default 0 or 1) instead of appending to it.
  form.addEventListener("focusin", (e) => {
    if (e.target.type === "number") setTimeout(() => e.target.select?.(), 0);
  });

  bindDialog(dlg);
  // Drop the form (and anything typed into it) once closed.
  dlg.addEventListener("close", () => dlg.replaceChildren(), { once: true });
  if (!dlg.open) dlg.showModal();
  form.querySelector("input:not([type=hidden]), select, textarea")?.focus();
  return form;
}
