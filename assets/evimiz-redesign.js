(function () {
  const navItems = [
    { label: "Ana Sayfa", href: "/evimiz-sahane", icon: "home" },
    { label: "Portfolyomuz", href: "/ilanlar", icon: "real_estate_agent" },
    { label: "Evimi Sat", href: "/evimi_sat_kirala_cretsiz_de_erleme", icon: "sell" },
    { label: "Kentsel Dönüşüm", href: "/kentsel_donusum", icon: "apartment" },
    { label: "Hakkımızda", href: "/hakkimizda_elite_estates", icon: "groups" },
    { label: "İletişim", href: "/i_leti_im_ve_randevu_elite_estates", icon: "mail" }
  ];

  const phoneHref = "tel:+902129842633";
  const whatsappHref = "https://wa.me/902129842633";
  const logoSrc = "/assets/evimiz-logo.png";

  function icon(name) {
    return `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
  }

  function logoMark() {
    return `
      <span class="evimiz-brand__mark" aria-hidden="true">
        <img src="${logoSrc}" alt="" loading="eager"/>
      </span>
    `;
  }

  function isCurrent(href) {
    const path = window.location.pathname.replace(/\/$/, "");
    return path === href || (href === "/ilanlar" && path === "/portf_y_ve_i_lanlar_elite_estates");
  }

  function navLinks(includeIcons) {
    return navItems
      .map((item) => {
        const current = isCurrent(item.href) ? ' aria-current="page"' : "";
        return `<a href="${item.href}"${current}>${includeIcons ? icon(item.icon) : ""}<span>${item.label}</span></a>`;
      })
      .join("");
  }

  function headerTemplate() {
    return `
      <header class="evimiz-shell-header">
        <a class="evimiz-brand" href="/evimiz-sahane" aria-label="Evimiz Şahane ana sayfa">
          ${logoMark()}
          <span>Evimiz Şahane</span>
        </a>
        <nav class="evimiz-desktop-nav" aria-label="Ana menü">
          ${navItems.slice(1).map((item) => {
            const current = isCurrent(item.href) ? ' aria-current="page"' : "";
            return `<a href="${item.href}"${current}>${item.label}</a>`;
          }).join("")}
        </nav>
        <a class="evimiz-cta" href="/i_leti_im_ve_randevu_elite_estates">ARA</a>
        <div class="evimiz-mobile-actions">
          <a class="evimiz-icon-button material-symbols-outlined" href="${phoneHref}" aria-label="Telefonla ara">phone</a>
          <a class="evimiz-icon-button material-symbols-outlined" href="${whatsappHref}" aria-label="WhatsApp">chat</a>
          <button class="evimiz-icon-button material-symbols-outlined" type="button" data-evimiz-menu-open aria-label="Menüyü aç">menu</button>
        </div>
      </header>
    `;
  }

  function drawerTemplate() {
    return `
      <div class="evimiz-drawer-overlay" data-evimiz-menu-overlay></div>
      <aside class="evimiz-drawer" data-evimiz-menu aria-label="Mobil menü">
        <div class="evimiz-drawer__top">
          <a class="evimiz-brand" href="/evimiz-sahane">
            ${logoMark()}
            <span>Evimiz Şahane</span>
          </a>
          <button class="evimiz-icon-button material-symbols-outlined" type="button" data-evimiz-menu-close aria-label="Menüyü kapat">close</button>
        </div>
        <nav aria-label="Mobil ana menü">${navLinks(true)}</nav>
        <div class="evimiz-drawer__ctas">
          <a class="evimiz-cta" href="${phoneHref}">${icon("phone")} Ara</a>
          <a class="evimiz-cta evimiz-wa" href="${whatsappHref}">${icon("chat")} WhatsApp</a>
        </div>
      </aside>
    `;
  }

  function footerTemplate() {
    return `
      <footer class="evimiz-footer">
        <a class="evimiz-brand" href="/evimiz-sahane">
          ${logoMark()}
          <span>Evimiz Şahane</span>
        </a>
        <nav class="evimiz-footer__nav" aria-label="Alt menü">${navLinks(false)}</nav>
        <p>© 2026 Evimiz Şahane. Tüm hakları saklıdır.</p>
      </footer>
    `;
  }

  function replaceShell() {
    document.querySelectorAll("header").forEach((node) => node.remove());
    document.querySelectorAll("#drawer, #drawerOverlay").forEach((node) => node.remove());
    document.body.insertAdjacentHTML("afterbegin", drawerTemplate());
    document.body.insertAdjacentHTML("afterbegin", headerTemplate());

    const oldFooter = document.querySelector("footer");
    if (oldFooter) oldFooter.outerHTML = footerTemplate();
    else document.body.insertAdjacentHTML("beforeend", footerTemplate());
  }

  function removeCommentsSection() {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"));
    headings.forEach((heading) => {
      const text = (heading.textContent || "").toLocaleLowerCase("tr-TR");
      const isCommentBlock = text.includes("ne diyor") || text.includes("yorum");
      if (!isCommentBlock) return;
      const section = heading.closest("section") || heading.parentElement;
      if (section) {
        section.remove();
      }
    });
  }

  function bindDrawer() {
    const drawer = document.querySelector("[data-evimiz-menu]");
    const overlay = document.querySelector("[data-evimiz-menu-overlay]");
    const openButtons = document.querySelectorAll("[data-evimiz-menu-open]");
    const closeButtons = document.querySelectorAll("[data-evimiz-menu-close]");
    const setOpen = (open) => {
      drawer?.classList.toggle("is-open", open);
      overlay?.classList.toggle("is-open", open);
      document.body.style.overflow = open ? "hidden" : "";
    };

    openButtons.forEach((button) => button.addEventListener("click", () => setOpen(true)));
    closeButtons.forEach((button) => button.addEventListener("click", () => setOpen(false)));
    overlay?.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    replaceShell();
    removeCommentsSection();
    bindDrawer();
  });
})();
