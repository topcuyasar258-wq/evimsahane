(function () {
  const drawer = document.querySelector("[data-site-drawer]");
  const overlay = document.querySelector("[data-site-drawer-overlay]");
  const openButtons = document.querySelectorAll("[data-site-menu-open]");
  const closeButtons = document.querySelectorAll("[data-site-menu-close]");

  function setDrawer(open) {
    drawer?.classList.toggle("is-open", open);
    overlay?.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  }

  openButtons.forEach((button) => {
    button.addEventListener("click", () => setDrawer(true));
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", () => setDrawer(false));
  });

  overlay?.addEventListener("click", () => setDrawer(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setDrawer(false);
  });

  const currentPath = window.location.pathname.replace(/\/$/, "") || "/evimiz-sahane";
  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    const href = (link.getAttribute("href") || "").replace(/\/$/, "");
    const isListings = href === "/ilanlar" && currentPath.startsWith("/ilan");
    if (href === currentPath || isListings) {
      link.setAttribute("aria-current", "page");
    }
  });

  document.querySelectorAll("[data-scroll-target]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      const target = document.querySelector(trigger.getAttribute("data-scroll-target"));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll("[data-choice-group]").forEach((group) => {
    group.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        group.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", "false"));
        button.setAttribute("aria-pressed", "true");
        const input = group.querySelector("input[type='hidden']");
        if (input) input.value = button.dataset.value || button.textContent.trim();
      });
    });
  });
})();
