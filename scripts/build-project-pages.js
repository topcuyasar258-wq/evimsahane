const fs = require("node:fs/promises");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const projectsFile = path.join(rootDir, "data", "projects.json");
const brandFile = path.join(rootDir, "data", "brand.json");
const outputDir = path.join(rootDir, "projeler");
const siteOrigin = "https://www.evimizsahane.com.tr";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteUrl(pathname) {
  return new URL(pathname, siteOrigin).toString();
}

function isPlaceholder(value) {
  return /^\[.+\]$/.test(String(value || "").trim());
}

function projectUrl(project) {
  return `/projeler/${project.slug}.html`;
}

function statusLabel(value) {
  const labels = {
    "tamamlandı": "Tamamlandı",
    tamamlandi: "Tamamlandı",
    devam: "Devam Ediyor",
    planlama: "Planlama"
  };
  return labels[String(value || "").toLocaleLowerCase("tr-TR")] || value || "[Durum bilgisi eklenecek]";
}

function head(project) {
  const title = `${project.ad} | Evimiz Şahane Projeler`;
  const description = project.ozet_meta_aciklama || `${project.ad} proje detayları ve görselleri.`;
  const canonical = absoluteUrl(projectUrl(project));
  const image = absoluteUrl(project.kapak_gorsel || "/assets/evimiz-logo.png");
  const schema = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: project.ad,
    description,
    url: canonical,
    image: (project.galeri || []).slice(0, 6).map((imageItem) => absoluteUrl(imageItem.src)),
    author: {
      "@type": "Organization",
      name: "Evimiz Şahane",
      url: siteOrigin
    },
    spatialCoverage: project.ilce ? {
      "@type": "Place",
      name: `${project.ilce}, İstanbul`
    } : undefined
  };
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <link rel="canonical" href="${escapeHtml(canonical)}"/>
  <meta property="og:title" content="${escapeHtml(title)}"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:url" content="${escapeHtml(canonical)}"/>
  <meta property="og:image" content="${escapeHtml(image)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeHtml(title)}"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>
  <meta name="twitter:image" content="${escapeHtml(image)}"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700;800&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@200..700,0..1&display=block" rel="stylesheet"/>
  <link rel="stylesheet" href="/assets/evimiz-tailwind.css?v=20260704-4"/>
  <link rel="stylesheet" href="/assets/evimiz-redesign.css?v=20260704-4"/>
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>
</head>`;
}

function siteHeader() {
  return `<div class="site-drawer-overlay" data-site-drawer-overlay></div>
  <aside class="site-drawer" data-site-drawer aria-label="Mobil menü">
    <div class="site-drawer__top">
      <a class="brand-lockup" href="/evimiz-sahane" aria-label="Evimiz Şahane ana sayfa"><img src="/assets/logo-evimiz-sahane.svg" alt="Evimiz Şahane"/></a>
      <button class="icon-button material-symbols-outlined" type="button" data-site-menu-close aria-label="Menüyü kapat">close</button>
    </div>
    <nav>
      <a href="/hakkimizda" data-nav-link><span class="material-symbols-outlined">domain</span>Kurumsal</a>
      <a href="/kentsel-donusum" data-nav-link><span class="material-symbols-outlined">apartment</span>Kentsel Dönüşüm</a>
      <a href="/projelerimiz" data-nav-link><span class="material-symbols-outlined">view_in_ar</span>Projelerimiz</a>
      <a href="/evimiz-sahane#teknik-surec" data-scroll-target="#teknik-surec"><span class="material-symbols-outlined">architecture</span>Teknik Süreç</a>
      <a href="/iletisim" data-nav-link><span class="material-symbols-outlined">mail</span>İletişim</a>
    </nav>
    <div class="site-drawer__actions">
      <a class="button button--orange" href="tel:+902129842633"><span class="material-symbols-outlined">phone</span>Ara</a>
      <a class="button button--whatsapp" href="https://wa.me/902129842633"><span class="material-symbols-outlined">chat</span>WhatsApp</a>
    </div>
  </aside>
  <header class="site-header">
    <a class="brand-lockup" href="/evimiz-sahane" aria-label="Evimiz Şahane ana sayfa"><img src="/assets/logo-evimiz-sahane.svg" alt="Evimiz Şahane"/></a>
    <nav class="site-nav" aria-label="Ana menü">
      <a href="/hakkimizda" data-nav-link>Kurumsal</a>
      <a href="/kentsel-donusum" data-nav-link>Kentsel Dönüşüm</a>
      <a href="/projelerimiz" data-nav-link aria-current="page">Projelerimiz</a>
      <a href="/evimiz-sahane#teknik-surec" data-scroll-target="#teknik-surec">Teknik Süreç</a>
      <a href="/iletisim" data-nav-link>İletişim</a>
    </nav>
    <div class="site-actions">
      <a class="button" href="/iletisim">Proje Görüşmesi Al <span class="material-symbols-outlined">arrow_forward</span></a>
      <button class="icon-button mobile-menu-button material-symbols-outlined" type="button" data-site-menu-open aria-label="Menüyü aç">menu</button>
    </div>
  </header>`;
}

function siteFooter(brand) {
  const contact = brand.contact || {};
  return `<footer class="site-footer">
    <div class="site-footer__brand">
      <a class="brand-lockup" href="/evimiz-sahane"><img src="/assets/logo-evimiz-sahane.svg" alt="Evimiz Şahane"/></a>
      <p class="site-footer__summary">${escapeHtml(brand.company?.description || "Evimiz Şahane; kentsel dönüşüm ve inşaat projelerinde kurumsal çözüm ortağıdır.")}</p>
    </div>
    <nav class="footer-nav" aria-label="Alt menü">
      <a href="/hakkimizda">Kurumsal</a>
      <a href="/kentsel-donusum">Kentsel Dönüşüm</a>
      <a href="/projelerimiz">Projelerimiz</a>
      <a href="/iletisim">İletişim</a>
      <a href="/kvkk">KVKK</a>
      <a href="/cerez-politikasi">Çerez Politikası</a>
    </nav>
    <div class="footer-contact">
      <a href="tel:${escapeHtml(contact.phoneHref || "+902129842633")}">${escapeHtml(contact.phoneDisplay || "0 (212) 984 26 33")}</a>
      <a href="mailto:${escapeHtml(contact.email || "info@evimizsahane.com")}">${escapeHtml(contact.email || "info@evimizsahane.com")}</a>
      <a href="https://wa.me/${escapeHtml(contact.whatsappHref || "902129842633")}">WhatsApp</a>
    </div>
    <nav class="footer-social" aria-label="Sosyal medya">
      <a href="https://www.instagram.com/evimizsahane" rel="noopener noreferrer">Instagram</a>
      <a href="https://www.linkedin.com/company/evimiz-sahane" rel="noopener noreferrer">LinkedIn</a>
      <a href="https://www.facebook.com/evimizsahane" rel="noopener noreferrer">Facebook</a>
    </nav>
    <div class="footer-legal">
      <a href="/kvkk">KVKK</a>
      <a href="/gizlilik-politikasi">Gizlilik Politikası</a>
      <a href="/cerez-politikasi">Çerez Politikası</a>
      <small>© 2026 Evimiz Şahane İnşaat ve Kentsel Dönüşüm.</small>
      <a class="back-to-top" href="#top">Yukarı çık</a>
    </div>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":["Organization","LocalBusiness"],"name":"Evimiz Şahane","url":"https://www.evimizsahane.com.tr","logo":"https://www.evimizsahane.com.tr/assets/logo-evimiz-sahane.svg","telephone":"+902129842633","email":"info@evimizsahane.com","address":{"@type":"PostalAddress","streetAddress":"Avcılar Merkez Mah. Ahmet Taner Kışlalı Cad. No: 23 İç Kapı No: 3","addressLocality":"Avcılar","addressRegion":"İstanbul","addressCountry":"TR"},"sameAs":["https://www.instagram.com/evimizsahane","https://www.linkedin.com/company/evimiz-sahane","https://www.facebook.com/evimizsahane"]}</script>
  </footer>`;
}

function summaryItems(project) {
  return [
    ["location_on", "Bölge", `${project.ilce || "[Bölge bilgisi eklenecek]"} / İstanbul`],
    ["square_foot", "Alan", project.m2],
    ["home_work", "Tip", (project.daire_tipleri || []).join(", ")],
    ["verified", "Durum", statusLabel(project.durum)],
    ["event_available", "Teslim", project.yil]
  ];
}

function gallery(project) {
  return (project.galeri || []).map((image, index) => `<button class="project-gallery__item" type="button" data-lightbox-trigger data-src="${escapeHtml(image.src)}" data-alt="${escapeHtml(image.alt)}">
    <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="${escapeHtml(image.width)}" height="${escapeHtml(image.height)}" loading="${index < 2 ? "eager" : "lazy"}"/>
  </button>`).join("");
}

function beforeAfter(project) {
  const after = project.sonra_gorsel || project.kapak_gorsel;
  const afterSize = project.sonra_gorsel_boyut || project.kapak_boyut || {};
  const beforeMarkup = project.once_gorsel
    ? `<img src="${escapeHtml(project.once_gorsel)}" alt="${escapeHtml(project.ad)} dönüşüm öncesi" loading="lazy"/>`
    : `<div class="missing-media"><span class="material-symbols-outlined">add_photo_alternate</span><strong>Öncesi görseli eklenecek</strong><p>Bu proje için dönüşüm öncesi fotoğraf geldiğinde karşılaştırma alanı tamamlanacak.</p></div>`;
  return `<div class="before-after">
    <article>
      <span>Öncesi</span>
      ${beforeMarkup}
    </article>
    <article>
      <span>Sonrası</span>
      <img src="${escapeHtml(after)}" alt="${escapeHtml(project.ad)} dönüşüm sonrası görseli" width="${escapeHtml(afterSize.width || "")}" height="${escapeHtml(afterSize.height || "")}" loading="lazy"/>
    </article>
  </div>`;
}

function relatedProjects(project, projects) {
  return projects
    .filter((item) => item.slug !== project.slug)
    .slice(0, 3)
    .map((item) => `<a class="project-card" href="${escapeHtml(projectUrl(item))}">
      <img src="${escapeHtml(item.kapak_gorsel)}" alt="${escapeHtml(item.ad)} kapak görseli" width="${escapeHtml(item.kapak_boyut?.width || "")}" height="${escapeHtml(item.kapak_boyut?.height || "")}" loading="lazy"/>
      <div><h3>${escapeHtml(item.ad)}</h3><p>${escapeHtml(item.ilce)} / İstanbul</p><small>${escapeHtml(statusLabel(item.durum))}</small></div>
    </a>`)
    .join("");
}

function mapBlock(project) {
  if (Number.isFinite(project.konum?.lat) && Number.isFinite(project.konum?.lng)) {
    const query = `${project.konum.lat},${project.konum.lng}`;
    return `<a class="project-map" href="https://www.google.com/maps/search/?api=1&query=${escapeHtml(query)}" rel="noopener noreferrer">
      <span class="material-symbols-outlined">map</span>
      <strong>Konumu Haritada Aç</strong>
      <small>${escapeHtml(project.ilce)} / İstanbul</small>
    </a>`;
  }
  return `<div class="project-map project-map--placeholder">
    <span class="material-symbols-outlined">map</span>
    <strong>Konum bilgisi eklenecek</strong>
    <small>Proje koordinatı geldiğinde harita linki aktif olacak.</small>
  </div>`;
}

function lightboxScript() {
  return `<dialog class="lightbox-dialog" data-lightbox>
    <button class="icon-button material-symbols-outlined" type="button" data-lightbox-close aria-label="Galeriyi kapat">close</button>
    <img data-lightbox-image alt=""/>
  </dialog>
  <script src="/assets/backend-client.js?v=20260704-4" defer></script>
  <script src="/assets/evimiz-redesign.js?v=20260704-4" defer></script>
  <script>
    (() => {
      const dialog = document.querySelector("[data-lightbox]");
      const image = document.querySelector("[data-lightbox-image]");
      document.querySelectorAll("[data-lightbox-trigger]").forEach((trigger) => {
        trigger.addEventListener("click", () => {
          image.src = trigger.dataset.src;
          image.alt = trigger.dataset.alt || "";
          dialog.showModal();
        });
      });
      document.querySelector("[data-lightbox-close]")?.addEventListener("click", () => dialog.close());
      dialog?.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    })();
  </script>`;
}

function renderProject(project, projects, brand) {
  const cover = project.galeri?.[0] || {};
  return `${head(project)}
<body class="brand-site" id="top">
  ${siteHeader()}
  <main>
    <section class="project-detail-hero">
      <div class="project-detail-hero__copy">
        <a class="breadcrumb-link" href="/projelerimiz">Projelerimiz</a>
        <h1>${escapeHtml(project.ad)}</h1>
        <p>${escapeHtml(project.ozet_meta_aciklama || project.aciklama)}</p>
        <div class="hero__actions">
          <a class="button button--orange" href="https://wa.me/${escapeHtml(brand.contact?.whatsappHref || "902129842633")}?text=${encodeURIComponent(`Merhaba, ${project.ad} projesi hakkında bilgi almak istiyorum.`)}">WhatsApp'tan Bilgi Al</a>
          <a class="button button--light" href="/iletisim">Proje Görüşmesi Al</a>
        </div>
      </div>
      <figure class="project-detail-hero__media">
        <img src="${escapeHtml(project.kapak_gorsel)}" alt="${escapeHtml(project.ad)} kapak görseli" width="${escapeHtml(cover.width)}" height="${escapeHtml(cover.height)}" fetchpriority="high"/>
      </figure>
    </section>

    <section class="section" aria-labelledby="project-summary-title">
      <div class="shell project-summary">
        <div>
          <h2 id="project-summary-title">Proje özeti.</h2>
          <p>${escapeHtml(project.aciklama)}</p>
        </div>
        <dl class="project-summary__grid">
          ${summaryItems(project).map(([icon, label, value]) => `<div><dt><span class="material-symbols-outlined">${escapeHtml(icon)}</span>${escapeHtml(label)}</dt><dd class="${isPlaceholder(value) ? "is-placeholder" : ""}">${escapeHtml(value)}</dd></div>`).join("")}
        </dl>
      </div>
    </section>

    <section class="section section--zumthor" aria-labelledby="project-gallery-title">
      <div class="shell section-heading-row">
        <div>
          <h2 id="project-gallery-title">Fotoğraf galerisi.</h2>
          <p>Görseller WebP formatında optimize edildi; detaylı görüntülemek için görsele tıklayın.</p>
        </div>
      </div>
      <div class="shell project-gallery">
        ${gallery(project)}
      </div>
    </section>

    <section class="section" aria-labelledby="before-after-title">
      <div class="shell split-heading">
        <div>
          <h2 id="before-after-title">Dönüşüm karşılaştırması.</h2>
          <p>Öncesi fotoğrafı geldiğinde bu alan gerçek görsel karşılaştırması olarak tamamlanacak.</p>
        </div>
        ${beforeAfter(project)}
      </div>
    </section>

    <section class="section section--black" aria-labelledby="project-location-title">
      <div class="shell project-location">
        <div>
          <h2 id="project-location-title">Konum ve görüşme.</h2>
          <p>${escapeHtml(project.ilce)} bölgesindeki proje için detaylı bilgi, güncel durum ve teknik kapsamı ekibimizle netleştirebilirsiniz.</p>
        </div>
        ${mapBlock(project)}
      </div>
    </section>

    <section class="section" aria-labelledby="related-projects-title">
      <div class="shell project-rail">
        <div>
          <h2 id="related-projects-title">Benzer projeler.</h2>
          <p class="section-lead">Kentsel dönüşüm ve villa geliştirme odağındaki diğer işlerimizi inceleyin.</p>
        </div>
        <div class="project-grid">${relatedProjects(project, projects)}</div>
      </div>
    </section>
  </main>
  ${siteFooter(brand)}
  ${lightboxScript()}
</body>
</html>`;
}

async function main() {
  const [projects, brand] = await Promise.all([
    fs.readFile(projectsFile, "utf8").then(JSON.parse),
    fs.readFile(brandFile, "utf8").then(JSON.parse)
  ]);
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(projects.map((project) => fs.writeFile(path.join(outputDir, `${project.slug}.html`), renderProject(project, projects, brand))));
  console.log(`Built ${projects.length} project pages in ${path.relative(rootDir, outputDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
