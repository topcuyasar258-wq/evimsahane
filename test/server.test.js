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

  for (const publicPath of ["assets/**", "*/code.html", "data/{brand,properties}.json"]) {
    assert.match(includeFiles, new RegExp(publicPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${publicPath} should be included in Vercel bundle`);
  }

  for (const privatePath of ["data/admin-users.json", "data/submissions.json", "uploads/"]) {
    assert.match(vercelIgnore, new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
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

test("renders public listings page", async () => {
  const response = await dispatch("GET", "/ilanlar");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Güncel Satılık ve Kiralık Portföyler/);
});

test("exposes crawl directives and sitemap", async () => {
  const robots = await dispatch("GET", "/robots.txt");
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /Allow: \//);
  assert.match(robots.body, /Sitemap: http:\/\/localhost:3000\/sitemap.xml/);

  const sitemap = await dispatch("GET", "/sitemap.xml");
  assert.equal(sitemap.statusCode, 200);
  assert.match(sitemap.body, /<loc>http:\/\/localhost:3000\/evimiz-sahane<\/loc>/);
  assert.match(sitemap.body, /<loc>http:\/\/localhost:3000\/ilanlar<\/loc>/);
});

test("renders homepage with primary heading and SEO metadata", async () => {
  const response = await dispatch("GET", "/evimiz-sahane");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<meta name="description"/);
  assert.match(response.body, /<link rel="canonical" href="https:\/\/www\.evimizsahane\.com\/"/);
  assert.match(response.body, /<h1 class="brand-hero__title/);
  assert.match(response.body, /name="name"/);
  assert.match(response.body, /autocomplete="name"/);
});

test("uses absolute canonical URLs for public listing pages", async () => {
  const response = await dispatch("GET", "/ilanlar");
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<link rel="canonical" href="http:\/\/localhost:3000\/ilanlar">/);
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
