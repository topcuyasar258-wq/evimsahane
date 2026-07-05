const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  cleanEmail,
  cleanPhone,
  normalizeProperty,
  requestHandler,
  slugify,
  validateLead
} = require("../server");
const serverModule = require("../server");

test("exports the request handler as the Vercel serverless entrypoint", () => {
  assert.equal(typeof serverModule, "function");
  assert.equal(serverModule.requestHandler, serverModule);
});

test("keeps Vercel server bundle assets explicit and runtime data private", () => {
  const vercelConfig = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const includeFiles = vercelConfig.functions["server.js"].includeFiles;
  const vercelIgnore = fs.readFileSync(".vercelignore", "utf8");

  for (const publicPath of ["assets/**", "*/code.html", "projeler/*.html", "data/{brand,properties,projects}.json"]) {
    assert.match(includeFiles, new RegExp(publicPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${publicPath} should be included in Vercel bundle`);
  }

  for (const privatePath of ["data/admin-users.json", "data/submissions.json", "uploads/"]) {
    assert.match(vercelIgnore, new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});

test("renders public pages without runtime Tailwind CDN render blockers", async () => {
  for (const target of ["/evimiz-sahane", "/projelerimiz", "/degerleme", "/kentsel-donusum"]) {
    const response = await dispatch("GET", target);
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body, /cdn\.tailwindcss\.com/);
    assert.doesNotMatch(response.body, /<script id="tailwind-config"/);
    assert.match(response.body, /\/assets\/evimiz-tailwind\.css\?v=20260704-4/);
    assert.match(response.body, /\/assets\/evimiz-redesign\.css\?v=20260704-4/);
  }
});

test("renders homepage as a corporate construction surface", async () => {
  const response = await dispatch("GET", "/evimiz-sahane");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Kurumsal İnşaat ve Kentsel Dönüşüm/);
  assert.match(response.body, /Proje Görüşmesi Al/);
  assert.doesNotMatch(response.body, /İlan Bul/);
});

test("serves static assets with long-lived immutable caching", async () => {
  const response = await dispatch("GET", "/assets/evimiz-redesign.css");
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["cache-control"], /max-age=31536000/);
  assert.match(response.headers["cache-control"], /immutable/);
});

test("validates email addresses", () => {
  assert.equal(cleanEmail(" INFO@EVIMIZSAHANE.COM "), "info@evimizsahane.com");
  assert.equal(cleanEmail("not-an-email"), "");
});

test("validates Turkish phone-like inputs", () => {
  assert.equal(cleanPhone("0 (212) 984 26 33"), "0 (212) 984 26 33");
  assert.equal(cleanPhone("abc123"), "");
});

test("builds a sanitized valuation lead", () => {
  const lead = validateLead(
    {
      name: " Ayşe  Yılmaz ",
      phone: "05 555 555 55 55",
      location: "Avcılar Merkez",
      propertyType: "Daire"
    },
    ["name", "phone", "location"]
  );

  assert.equal(lead.name, "Ayşe Yılmaz");
  assert.equal(lead.location, "Avcılar Merkez");
  assert.equal(lead.propertyType, "Daire");
  assert.ok(lead.id);
  assert.ok(lead.createdAt);
});

test("rejects missing required lead fields", () => {
  assert.throws(
    () => validateLead({ name: "Ali" }, ["name", "phone"]),
    /Zorunlu alanlar/
  );
});

test("creates Turkish-safe property slugs", () => {
  assert.equal(slugify("Kadıköy Feneryolu 3+1 Satılık Daire"), "kadikoy-feneryolu-3-1-satilik-daire");
});

test("normalizes legacy property data for public rendering", () => {
  const property = normalizeProperty({
    id: "legacy-id",
    title: "Avcılar Merkezde Yeni Yaşam Dairesi",
    status: "SATILIK",
    type: "Daire",
    location: "Avcılar, İstanbul",
    price: "₺8.750.000",
    rooms: "3+1",
    areaM2: 145,
    image: "https://example.com/home.jpg"
  });

  assert.equal(property.slug, "legacy-id");
  assert.equal(property.listingType, "satilik");
  assert.equal(property.status, "active");
  assert.equal(property.city, "İstanbul");
  assert.equal(property.district, "Avcılar");
  assert.equal(property.coverImage, "https://example.com/home.jpg");
});

test("redirects unauthenticated admin users to login", async () => {
  const response = await dispatch("GET", "/admin/ilanlar");
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/admin/login");
});

test("no longer serves a public listings page", async () => {
  const response = await dispatch("GET", "/ilanlar");
  assert.equal(response.statusCode, 404);
});

test("renders projects as a separate construction portfolio", async () => {
  const response = await dispatch("GET", "/projelerimiz");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Yalnızca portföy değil, teslim disiplini/);
  assert.match(response.body, /\/assets\/projects\//);
});

test("renders urban transformation content with FAQ schema and project links", async () => {
  const response = await dispatch("GET", "/kentsel-donusum");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Riskli Yapıdan Güvenli Yaşama/);
  assert.match(response.body, /Riskli Yapı Tespiti/);
  assert.match(response.body, /FAQPage/);
  assert.match(response.body, /salt çoğunluğu \(P\+1\)/);
  assert.match(response.body, /href="\/projeler\/selimpasa-64-daire\.html"/);
});

test("exposes crawl directives and sitemap", async () => {
  const robots = await dispatch("GET", "/robots.txt");
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /Allow: \//);
  assert.match(robots.body, /Sitemap: http:\/\/localhost:3000\/sitemap.xml/);

  const sitemap = await dispatch("GET", "/sitemap.xml");
  assert.equal(sitemap.statusCode, 200);
  assert.match(sitemap.body, /<loc>http:\/\/localhost:3000\/evimiz-sahane<\/loc>/);
  assert.match(sitemap.body, /<loc>http:\/\/localhost:3000\/projelerimiz<\/loc>/);
  assert.match(sitemap.body, /<loc>http:\/\/localhost:3000\/degerleme<\/loc>/);
  assert.match(sitemap.body, /<loc>http:\/\/localhost:3000\/projeler\/selimpasa-64-daire\.html<\/loc>/);
  assert.doesNotMatch(sitemap.body, /\/ilanlar|\/ilan\//);
});

test("renders homepage with primary heading and SEO metadata", async () => {
  const response = await dispatch("GET", "/evimiz-sahane");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<meta name="description"/);
  assert.match(response.body, /<link rel="canonical" href="http:\/\/localhost:3000\/evimiz-sahane"/);
  assert.doesNotMatch(response.body, /evimizsahane\.com\//);
  assert.match(response.body, /<h1 class="brand-hero__title/);
  assert.match(response.body, /Kentsel Dönüşüm Süreci/);
  assert.match(response.body, /Teknik disiplin/);
});

test("uses absolute canonical URLs for the projects portfolio page", async () => {
  const response = await dispatch("GET", "/projelerimiz");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<link rel="canonical" href="http:\/\/localhost:3000\/projelerimiz">/);
});

test("keeps production canonicals on the .com.tr domain", async () => {
  const response = await dispatch("GET", "/projelerimiz", null, { host: "www.evimizsahane.com" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<link rel="canonical" href="https:\/\/www\.evimizsahane\.com\.tr\/projelerimiz">/);
  assert.match(response.body, /<meta property="og:url" content="https:\/\/www\.evimizsahane\.com\.tr\/projelerimiz">/);
});

test("redirects template residue URLs to clean public routes", async () => {
  const redirects = [
    ["/hakkimizda_elite_estates", "/hakkimizda"],
    ["/i_leti_im_ve_randevu_elite_estates", "/iletisim"],
    ["/evimi_sat_kirala_cretsiz_de_erleme", "/degerleme"],
    ["/kentsel_donusum", "/kentsel-donusum"]
  ];

  for (const [from, to] of redirects) {
    const response = await dispatch("GET", from);
    assert.equal(response.statusCode, 301);
    assert.equal(response.headers.location, to);
  }
});

test("renders clean static routes with clean canonical URLs", async () => {
  const response = await dispatch("GET", "/hakkimizda");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<link rel="canonical" href="http:\/\/localhost:3000\/hakkimizda"/);
  assert.doesNotMatch(response.body, /elite_estates|i_leti_im|kentsel_donusum/);
});

test("uses absolute project OG images and consistent project locations", async () => {
  const response = await dispatch("GET", "/projelerimiz");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<meta property="og:image" content="http:\/\/localhost:3000\/assets\/projects\/selimpasa-64-daire\/01\.webp">/);
  assert.match(response.body, /Selimpaşa 64 Daire/);
  assert.match(response.body, /Selimpaşa \/ İstanbul/);
  assert.match(response.body, /href="\/projeler\/selimpasa-64-daire\.html"/);
});

test("renders static project detail pages with SEO and schema", async () => {
  const response = await dispatch("GET", "/projeler/selimpasa-64-daire.html");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Selimpaşa 64 Daire/);
  assert.match(response.body, /<link rel="canonical" href="http:\/\/localhost:3000\/projeler\/selimpasa-64-daire\.html"/);
  assert.match(response.body, /<meta property="og:image" content="http:\/\/localhost:3000\/assets\/projects\/selimpasa-64-daire\/01\.webp"\/?>/);
  assert.match(response.body, /CreativeWork/);
  assert.match(response.body, /data-lightbox-trigger/);
  assert.match(response.body, /Öncesi görseli eklenecek/);
});

test("footer exposes legal and social trust links", async () => {
  const response = await dispatch("GET", "/evimiz-sahane");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /href="\/kvkk"/);
  assert.match(response.body, /href="\/cerez-politikasi"/);
  assert.match(response.body, /Instagram|LinkedIn|Facebook/);
});

test("renders legal trust pages from footer links", async () => {
  for (const target of ["/kvkk", "/cerez-politikasi"]) {
    const response = await dispatch("GET", target);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Evimiz Şahane/);
    assert.match(response.body, /<link rel="canonical"/);
  }
});

test("serves uploaded listing images without exposing private runtime data", async () => {
  const response = await dispatch("GET", "/uploads/properties/d08a2368-0ef1-4d8f-a100-8dc2ecd444c1/1782956121285-1-8a6c18aa-1abe-47d9-b31b-a3f910aa073e.png");
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "image/png");
});

test("accepts contact leads with phone when email is omitted", async () => {
  const response = await dispatch(
    "POST",
    "/api/contact-requests",
    JSON.stringify({ name: "Ayşe Yılmaz", phone: "05 555 555 55 55", message: "Randevu almak istiyorum." }),
    { "content-type": "application/json" }
  );

  assert.equal(response.statusCode, 201);
  assert.match(response.body, /Ayşe Yılmaz/);
});

test("does not serve private runtime files as static assets", async () => {
  for (const target of ["/data/admin-users.json", "/data/submissions.json", "/.vercel/repo.json"]) {
    const response = await dispatch("GET", target);
    assert.equal(response.statusCode, 404);
    assert.doesNotMatch(response.body, /passwordHash|contactRequests|projectId|orgId/);
  }
});

function dispatch(method, target, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = new ReadableRequest(method, target, body, headers);
    const res = {
      headers: {},
      statusCode: 200,
      writeHead(statusCode, responseHeaders = {}) {
        this.statusCode = statusCode;
        this.headers = normalizeHeaders(responseHeaders);
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk) {
        if (chunk) this.write(chunk);
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      }
    };

    Promise.resolve(requestHandler(req, res)).catch(reject);
  });
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

class ReadableRequest {
  constructor(method, url, body, headers) {
    this.method = method;
    this.url = url;
    this.headers = { host: "localhost:3000", ...headers };
    this.socket = { remoteAddress: "127.0.0.1" };
    this.body = body ? [Buffer.from(body)] : [];
  }

  async *[Symbol.asyncIterator]() {
    yield* this.body;
  }
}
