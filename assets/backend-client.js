(function () {
  const api = {
    brand: "/api/brand",
    properties: "/api/properties?featured=true",
    appointments: "/api/appointments",
    valuations: "/api/valuation-requests",
    contacts: "/api/contact-requests"
  };

  function text(value) {
    return String(value || "").trim();
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "İstek gönderilemedi.");
      }
      return result.data;
    });
  }

  function notify(message, isError) {
    const note = document.createElement("div");
    note.textContent = message;
    note.setAttribute("role", "status");
    note.style.cssText = [
      "position:fixed",
      "left:16px",
      "right:16px",
      "bottom:88px",
      "z-index:9999",
      "margin:auto",
      "max-width:520px",
      "padding:14px 16px",
      "border-radius:8px",
      "box-shadow:0 12px 32px rgba(0,0,0,.18)",
      "font:600 14px/1.4 Inter,system-ui,sans-serif",
      `background:${isError ? "#ba1a1a" : "#111111"}`,
      "color:#ffffff"
    ].join(";");
    document.body.appendChild(note);
    window.setTimeout(() => note.remove(), 3600);
  }

  function brandMarkup(brand) {
    const logo = brand.assets && brand.assets.logoIcon;
    return `${logo ? `<img src="${logo}" alt="" style="width:32px;height:32px;object-fit:contain;border-radius:4px">` : ""}<span>${brand.company.name}</span>`;
  }

  function applyPalette(palette) {
    const style = document.createElement("style");
    style.textContent = `
      .text-secondary, .hover\\:text-primary:hover { color: ${palette.primary} !important; }
      .bg-secondary, .bg-secondary-container, .dark .dark\\:bg-secondary { background-color: ${palette.primary} !important; }
      .border-secondary, .focus\\:border-secondary:focus { border-color: ${palette.primary} !important; }
      .focus\\:ring-secondary:focus, .focus\\:ring-secondary\\/20:focus { --tw-ring-color: ${palette.primary}33 !important; }
      .text-on-secondary, .text-on-secondary-container { color: ${palette.white} !important; }
      .bg-primary, .bg-primary-container { background-color: ${palette.black} !important; }
      .text-primary { color: ${palette.black} !important; }
      .bg-primary .text-on-primary-container,
      .bg-primary-container .text-on-primary-container,
      .text-on-primary-container { color: ${palette.white} !important; }
      .bg-surface, .bg-background { background-color: ${palette.softBlue} !important; }
      .bg-surface-variant, .bg-surface-container, .bg-surface-container-high, .bg-surface-container-highest { background-color: ${palette.gray} !important; }
    `;
    document.head.appendChild(style);
  }

  function replaceBrandText(brand) {
    document.title = document.title.replace(/Elite Estates|ELITE ESTATES|Property Detail/g, brand.company.name);

    document.querySelectorAll("h1,h2,span,div").forEach((element) => {
      if (text(element.textContent).match(/^ELITE ESTATES$|^Elite Estates$/)) {
        element.innerHTML = brandMarkup(brand);
        element.style.display = "inline-flex";
        element.style.alignItems = "center";
        element.style.gap = "10px";
      }
    });

    replaceTextNodes([
      [/Elite Estates|ELITE ESTATES/g, brand.company.name],
      [/© 2024 Evimiz Şahane\. All rights reserved\./g, brand.copyright],
      [/Search Properties/g, "Portföyler"],
      [/Market Insights/g, "Değerleme"],
      [/Meet Our Agents/g, "Uzmanlık Alanları"],
      [/Contact Us/g, "İletişim"],
      [/Privacy Policy/g, "Gizlilik"],
      [/Terms of Service/g, "Kullanım"],
      [/Cookie Policy/g, "Çerezler"],
      [/^CALL$/g, "ARA"],
      [/^Call$/g, "Ara"],
      [/^Book$/g, "Randevu"]
    ]);
  }

  function replaceTextNodes(replacements) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const next = replacements.reduce((value, replacement) => value.replace(replacement[0], replacement[1]), node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });
  }

  function applyContactLinks(brand) {
    const phoneHref = `tel:${brand.contact.phoneHref}`;
    const whatsAppHref = `https://wa.me/${brand.contact.whatsappHref}`;

    document.querySelectorAll('a[href^="tel:"]').forEach((link) => {
      link.setAttribute("href", phoneHref);
    });
    document.querySelectorAll('a[href^="https://wa.me/"]').forEach((link) => {
      link.setAttribute("href", whatsAppHref);
    });
    document.querySelectorAll("button,a").forEach((element) => {
      if (["ARA", "Ara", "Hemen Ara"].includes(text(element.textContent))) {
        element.addEventListener("click", () => {
          window.location.href = phoneHref;
        });
      }
    });

    replaceTextNodes([
      [/Levent Plaza, Büyükdere Cd\. No:173, Kat:12, Beşiktaş, İstanbul/g, brand.contact.address],
      [/0 \(212\) 000 00 00/g, brand.contact.phoneDisplay]
    ]);
  }

  function inputsByForm(form) {
    const controls = Array.from(form.querySelectorAll("input,select,textarea"));
    return controls.reduce((payload, control) => {
      const placeholder = text(control.getAttribute("placeholder")).toLocaleLowerCase("tr-TR");
      const label = text(control.closest(".space-y-1,.space-y-xs")?.querySelector("label")?.textContent).toLocaleLowerCase("tr-TR");
      const key = `${label} ${placeholder}`;
      const value = text(control.value);

      if (!value) return payload;
      if (key.includes("ad")) return { ...payload, name: value };
      if (key.includes("telefon")) return { ...payload, phone: value };
      if (key.includes("mail") || key.includes("e-posta")) return { ...payload, email: value };
      if (key.includes("adres") || key.includes("mülk")) return { ...payload, propertyAddress: value };
      if (key.includes("konum") || key.includes("ilçe")) return { ...payload, location: value };
      if (key.includes("tip")) return { ...payload, propertyType: value };
      if (key.includes("konu") || key.includes("ilgi")) return { ...payload, topic: value };
      if (control.type === "date") return { ...payload, preferredDate: value };
      if (control.type === "time") return { ...payload, preferredTime: value };
      return { ...payload, message: value };
    }, {});
  }

  function endpointForForm(form) {
    const pathname = window.location.pathname.toLocaleLowerCase("tr-TR");
    const formText = text(form.textContent).toLocaleLowerCase("tr-TR");
    if (pathname.includes("de_erleme") || formText.includes("değerleme") || formText.includes("ekspertiz")) {
      return api.valuations;
    }
    if (formText.includes("randevu")) return api.appointments;
    return api.contacts;
  }

  function wireForms() {
    document.querySelectorAll("form").forEach((form) => {
      form.removeAttribute("onsubmit");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = inputsByForm(form);
        const endpoint = endpointForForm(form);
        if (endpoint === api.valuations && !payload.location && payload.propertyAddress) {
          payload.location = payload.propertyAddress;
        }

        try {
          await postJson(endpoint, payload);
          form.reset();
          notify("Talebiniz alındı. Ekibimiz sizinle iletişime geçecek.", false);
        } catch (error) {
          notify(error.message, true);
        }
      });
    });
  }

  async function init() {
    try {
      const response = await fetch(api.brand);
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      applyPalette(result.data.palette);
      replaceBrandText(result.data);
      applyContactLinks(result.data);
      wireForms();
    } catch (error) {
      console.error("Backend client başlatılamadı:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
