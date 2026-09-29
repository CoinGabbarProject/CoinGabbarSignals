(() => {
  "use strict";

  const footer = document.getElementById("site-footer");
  if (!footer) return;

  const columns = [...footer.querySelectorAll(".cgs-footer__column")];
  const mobileQuery = window.matchMedia("(max-width: 767px)");

  function setColumn(column, open) {
    column.dataset.open = String(open);
    const button = column.querySelector(".cgs-footer__mobile-toggle");
    const panel = column.querySelector(".cgs-footer__column-content");
    if (button) button.setAttribute("aria-expanded", String(open));
    if (panel) panel.setAttribute("aria-hidden", String(!open));
  }

  function syncFooter() {
    columns.forEach(column => {
      setColumn(column, !mobileQuery.matches);
    });
  }

  columns.forEach(column => {
    const button = column.querySelector(".cgs-footer__mobile-toggle");
    if (!button) return;
    button.addEventListener("click", () => {
      if (!mobileQuery.matches) return;
      setColumn(column, column.dataset.open !== "true");
    });
  });

  mobileQuery.addEventListener?.("change", syncFooter);
  syncFooter();

  const year = document.querySelector("[data-cgs-current-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  window.CoinGabbarSignalsFooter = {
    setDataSources(sources = []) {
      const list = footer.querySelector("[data-cgs-source-list]");
      if (!list) return;
      list.replaceChildren();
      sources.forEach(source => {
        if (!source || typeof source.name !== "string") return;
        const item = document.createElement("span");
        item.className = "cgs-footer__source-chip";
        item.textContent = source.name;
        list.appendChild(item);
      });
    },
    setRoute(selector, route) {
      const link = footer.querySelector(selector);
      if (!link || typeof route !== "string" || !route.trim()) return;
      link.href = route;
      link.classList.remove("cgs-footer__pending");
      link.removeAttribute("aria-disabled");
    }
  };
})();
