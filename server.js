const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads", "properties");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const productionOrigin = (process.env.PUBLIC_SITE_ORIGIN || "https://www.evimizsahane.com.tr").replace(/\/+$/, "");
const maxJsonBodyBytes = 1024 * 64;
const maxUploadBytes = 1024 * 1024 * 110;
const maxImageBytes = 1024 * 1024 * 5;
const maxImagesPerProperty = 20;
const rateWindowMs = 60_000;
const rateLimit = 120;
const adminSessionMs = 1000 * 60 * 60 * 8;
const requestLog = new Map();
const sessions = new Map();
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const publicDataFiles = {
  "brand.json": path.join(rootDir, "data", "brand.json"),
  "properties.json": path.join(rootDir, "data", "properties.json"),
  "projects.json": path.join(rootDir, "data", "projects.json")
};
const mutableDataFileNames = new Set(["admin-users.json", "submissions.json"]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const allowedListingTypes = new Set(["satilik", "kiralik"]);
const allowedPropertyTypes = new Set(["daire", "villa", "arsa", "isyeri", "dubleks", "residence", "mustakil_ev"]);
const allowedStatuses = new Set(["active", "passive", "sold", "rented"]);
const allowedCurrencies = new Set(["TL", "USD", "EUR"]);
const imageTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
const privateStaticRoots = new Set([".git", ".vercel", "data", "node_modules", "uploads"]);
const templateSourceOrigins = [
  "https://www.evimizsahane.com.tr",
  "https://www.evimizsahane.com"
];

function traceVercelRuntimeFiles() {
  const files = [
    fsSync.readFileSync(path.join(rootDir, "ana_sayfa_elite_estates", "code.html")),
    fsSync.readFileSync(path.join(rootDir, "assets", "backend-client.js")),
    fsSync.readFileSync(path.join(rootDir, "assets", "evimiz-logo.png")),
    fsSync.readFileSync(path.join(rootDir, "assets", "evimiz-redesign.css")),
    fsSync.readFileSync(path.join(rootDir, "assets", "evimiz-redesign.js")),
    fsSync.readFileSync(path.join(rootDir, "assets", "evimiz-tailwind.css")),
    fsSync.readFileSync(path.join(rootDir, "data", "brand.json")),
    fsSync.readFileSync(path.join(rootDir, "data", "projects.json")),
    fsSync.readFileSync(path.join(rootDir, "data", "properties.json")),
    fsSync.readFileSync(path.join(rootDir, "evimi_sat_kirala_cretsiz_de_erleme", "code.html")),
    fsSync.readFileSync(path.join(rootDir, "hakkimizda_elite_estates", "code.html")),
    fsSync.readFileSync(path.join(rootDir, "i_leti_im_ve_randevu_elite_estates", "code.html")),
    fsSync.readFileSync(path.join(rootDir, "kentsel_donusum", "code.html")),
    fsSync.readFileSync(path.join(rootDir, "portf_y_ve_i_lanlar_elite_estates", "code.html"))
  ];
  const projectDir = path.join(rootDir, "projeler");
  if (fsSync.existsSync(projectDir)) {
    for (const fileName of fsSync.readdirSync(projectDir)) {
      if (fileName.endsWith(".html")) files.push(fsSync.readFileSync(path.join(projectDir, fileName)));
    }
  }
  return files;
}

if (process.env.EVIMSAHANE_TRACE_RUNTIME_FILES === "1") {
  traceVercelRuntimeFiles();
}

function envelope(data, meta) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

function errorEnvelope(message, details) {
  return { success: false, error: message, ...(details ? { details } : {}) };
}

function siteOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000").split(",")[0].trim();
  if (!/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$|^\[::1\](?::\d+)?$/.test(host)) {
    return productionOrigin;
  }
  return `${proto}://${host}`;
}

function absoluteUrl(req, pathname) {
  return new URL(pathname, siteOrigin(req)).toString();
}

function absolutePublicUrl(req, value) {
  if (/^https?:\/\//i.test(String(value || ""))) return value;
  return absoluteUrl(req, value || "/");
}

function rewriteStaticHtmlOrigins(body, req) {
  return templateSourceOrigins.reduce(
    (html, origin) => html.replaceAll(origin, siteOrigin(req)),
    body
  );
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendHtml(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; "),
    ...extraHeaders
  });
  res.end(body);
}

function sendRedirect(res, location, headers = {}, statusCode = 302) {
  res.writeHead(statusCode, { location, ...headers });
  res.end();
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "public, max-age=3600",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function checkRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < rateWindowMs);
  if (recent.length >= rateLimit) {
    requestLog.set(ip, recent);
    return false;
  }
  requestLog.set(ip, [...recent, now]);
  return true;
}

async function readJson(fileName, fallback) {
  try {
    const raw = await fs.readFile(dataFilePath(fileName), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJson(fileName, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFilePath(fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function dataFilePath(fileName) {
  if (publicDataFiles[fileName]) return publicDataFiles[fileName];
  if (mutableDataFileNames.has(fileName)) {
    const privateDataDir = process.env.EVIMSAHANE_PRIVATE_DATA_DIR || path.join(rootDir, ["d", "ata"].join(""));
    return path.join(privateDataDir, fileName);
  }
  throw Object.assign(new Error("Bilinmeyen veri dosyası."), { statusCode: 500 });
}

async function readRawBody(req, limitBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      throw Object.assign(new Error("İstek gövdesi çok büyük."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readBody(req) {
  const buffer = await readRawBody(req, maxJsonBodyBytes);
  if (buffer.length === 0) return {};

  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Geçerli JSON gönderin."), { statusCode: 400 });
  }
}

function cleanText(value, maxLength = 240) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 5000) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanPhone(value) {
  const phone = cleanText(value, 40);
  return /^[+()\d\s-]{7,40}$/.test(phone) ? phone : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToParagraphs(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, "<br>"))
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
}

function slugify(value) {
  const normalized = String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "ilan";
}

function displayType(value) {
  const labels = {
    satilik: "Satılık",
    kiralik: "Kiralık",
    daire: "Daire",
    villa: "Villa",
    arsa: "Arsa",
    isyeri: "İşyeri",
    dubleks: "Dubleks",
    residence: "Residence",
    mustakil_ev: "Müstakil Ev",
    active: "Aktif",
    passive: "Pasif",
    sold: "Satıldı",
    rented: "Kiralandı"
  };
  return labels[value] || value || "-";
}

function projectStatusLabel(value) {
  const normalized = String(value || "").toLocaleLowerCase("tr-TR");
  const labels = {
    "tamamlandı": "Tamamlandı",
    tamamlandi: "Tamamlandı",
    devam: "Devam Ediyor",
    planlama: "Planlama"
  };
  return labels[normalized] || value || "[Durum bilgisi eklenecek]";
}

function projectDetailHref(project) {
  return `/projeler/${encodeURIComponent(project.slug)}.html`;
}

function isProjectPortfolioItem(property) {
  const coverImage = String(property.coverImage || "");
  return Boolean(property.featured) && coverImage.startsWith("/assets/projects/");
}

function isPublicListing(property) {
  const coverImage = String(property.coverImage || "");
  return property.status === "active" && coverImage.startsWith("/uploads/properties/");
}

function priceText(property) {
  if (property.priceText) return property.priceText;
  const rawPrice = String(property.price || "").trim();
  if (/^[₺$€]/.test(rawPrice)) return rawPrice;
  const amount = Number(rawPrice.replace(/[^\d]/g, ""));
  if (!amount) return "-";
  return `${new Intl.NumberFormat("tr-TR").format(amount)} ${property.currency || "TL"}`;
}

function normalizeProperty(raw) {
  const locationParts = String(raw.location || "").split(",").map((part) => part.trim()).filter(Boolean);
  const legacyStatus = String(raw.status || "").toLocaleLowerCase("tr-TR");
  const listingType = raw.listingType || raw.listing_type || (legacyStatus.includes("kiral") ? "kiralik" : "satilik");
  const normalizedStatus = allowedStatuses.has(raw.status) ? raw.status : "active";
  const rawPrice = String(raw.price || "");
  const images = Array.isArray(raw.images)
    ? raw.images
    : (raw.image ? [{ id: "legacy-cover", url: raw.image, alt: raw.title || "İlan görseli", sortOrder: 0 }] : []);

  return {
    id: raw.id || crypto.randomUUID(),
    title: cleanText(raw.title, 180),
    slug: raw.slug || raw.id || slugify(raw.title),
    listingType,
    propertyType: raw.propertyType || raw.property_type || raw.type || "Daire",
    price: raw.price ?? "",
    priceText: raw.priceText || (/^[₺$€]/.test(rawPrice) || rawPrice.includes("/ay") ? rawPrice : ""),
    currency: raw.currency || "TL",
    city: raw.city || locationParts[1] || "İstanbul",
    district: raw.district || locationParts[0] || "",
    neighborhood: raw.neighborhood || "",
    addressDetail: raw.addressDetail || raw.address_detail || "",
    grossM2: raw.grossM2 || raw.gross_m2 || raw.areaM2 || "",
    netM2: raw.netM2 || raw.net_m2 || "",
    roomCount: raw.roomCount || raw.room_count || raw.rooms || "",
    salonCount: raw.salonCount || raw.salon_count || "",
    buildingAge: raw.buildingAge || raw.building_age || "",
    floor: raw.floor || "",
    totalFloors: raw.totalFloors || raw.total_floors || "",
    heating: raw.heating || "",
    bathroomCount: raw.bathroomCount || raw.bathroom_count || raw.bathrooms || "",
    hasBalcony: Boolean(raw.hasBalcony || raw.has_balcony),
    isFurnished: Boolean(raw.isFurnished || raw.is_furnished),
    dues: raw.dues || "",
    creditEligible: Boolean(raw.creditEligible || raw.credit_eligible),
    swapAvailable: Boolean(raw.swapAvailable || raw.swap_available),
    description: raw.description || "Detaylı bilgi almak için bizimle iletişime geçin.",
    coverImage: raw.coverImage || raw.cover_image || raw.image || images[0]?.url || "",
    seoTitle: raw.seoTitle || raw.seo_title || raw.title || "",
    seoDescription: raw.seoDescription || raw.seo_description || "",
    status: normalizedStatus,
    featured: Boolean(raw.featured),
    images,
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.updated_at || raw.createdAt || raw.created_at || new Date().toISOString()
  };
}

async function readProperties() {
  const properties = await readJson("properties.json", []);
  return properties.map(normalizeProperty);
}

async function readProjects() {
  return readJson("projects.json", []);
}

async function writeProperties(properties) {
  await writeJson("properties.json", properties);
}

async function uniqueSlug(baseSlug, currentId = "") {
  const properties = await readProperties();
  let candidate = slugify(baseSlug);
  let counter = 2;
  while (properties.some((property) => property.slug === candidate && property.id !== currentId)) {
    candidate = `${slugify(baseSlug)}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function validateLead(body, requiredFields) {
  const lead = {
    id: crypto.randomUUID(),
    name: cleanText(body.name || body.fullName),
    phone: cleanPhone(body.phone),
    email: cleanEmail(body.email),
    topic: cleanText(body.topic || body.interest || body.transactionType),
    message: cleanText(body.message, 1000),
    propertyAddress: cleanText(body.propertyAddress || body.address),
    location: cleanText(body.location),
    propertyType: cleanText(body.propertyType),
    preferredDate: cleanText(body.preferredDate || body.date, 40),
    preferredTime: cleanText(body.preferredTime || body.time, 40),
    createdAt: new Date().toISOString()
  };

  const missing = requiredFields.filter((field) => !lead[field]);
  if (missing.length > 0) {
    throw Object.assign(new Error("Zorunlu alanlar eksik veya geçersiz."), {
      statusCode: 422,
      details: { missing }
    });
  }

  return lead;
}

async function appendSubmission(bucket, lead) {
  const submissions = await readJson("submissions.json", {});
  const current = Array.isArray(submissions[bucket]) ? submissions[bucket] : [];
  const next = { ...submissions, [bucket]: [...current, lead] };
  await writeJson("submissions.json", next);
  return lead;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((cookie) => {
    const [name, ...rest] = cookie.trim().split("=");
    return [name, decodeURIComponent(rest.join("=") || "")];
  }).filter(([name]) => name));
}

function cookieFlags(req, maxAgeSeconds) {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function getSession(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    sendRedirect(res, "/admin/login");
    return null;
  }
  return session;
}

function validateCsrf(session, value) {
  if (!session || !value || value !== session.csrfToken) {
    throw Object.assign(new Error("Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin."), { statusCode: 403 });
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), iterations = 310000) {
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, iterationsText, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterationsText), 32, "sha256");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), actual);
}

async function readAdmins() {
  return readJson("admin-users.json", []);
}

async function ensureEnvAdmin() {
  const admins = await readAdmins();
  if (admins.length > 0 || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return admins;
  const now = new Date().toISOString();
  const admin = {
    id: crypto.randomUUID(),
    username: cleanText(process.env.ADMIN_USERNAME, 80),
    email: cleanEmail(process.env.ADMIN_EMAIL || "admin@example.com"),
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD),
    role: "admin",
    createdAt: now,
    updatedAt: now
  };
  const next = [admin];
  await writeJson("admin-users.json", next);
  return next;
}

async function parseUrlEncoded(req) {
  const buffer = await readRawBody(req, maxJsonBodyBytes);
  return Object.fromEntries(new URLSearchParams(buffer.toString("utf8")));
}

async function parseMultipart(req) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw Object.assign(new Error("Form verisi okunamadı."), { statusCode: 400 });
  }
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const raw = (await readRawBody(req, maxUploadBytes)).toString("binary");
  const fields = {};
  const files = [];

  for (const chunk of raw.split(boundary)) {
    if (!chunk || chunk === "--\r\n" || chunk === "--") continue;
    const part = chunk.replace(/^\r\n/, "").replace(/\r\n--$/, "");
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd);
    const bodyText = part.slice(headerEnd + 4).replace(/\r\n$/, "");
    const name = headerText.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const filename = headerText.match(/filename="([^"]*)"/)?.[1];
    const type = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";
    if (filename) {
      const buffer = Buffer.from(bodyText, "binary");
      if (buffer.length > 0) files.push({ field: name, filename, type, buffer });
      continue;
    }
    const value = Buffer.from(bodyText, "binary").toString("utf8");
    if (fields[name] === undefined) fields[name] = value;
    else if (Array.isArray(fields[name])) fields[name] = [...fields[name], value];
    else fields[name] = [fields[name], value];
  }

  return { fields, files };
}

function ensureAllowedImage(file) {
  const ext = path.extname(file.filename).toLowerCase();
  const expectedExt = imageTypes[file.type];
  if (!expectedExt || ![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    throw Object.assign(new Error("Yalnızca jpg, jpeg, png veya webp görseller yüklenebilir."), { statusCode: 422 });
  }
  if (file.buffer.length > maxImageBytes) {
    throw Object.assign(new Error("Her görsel en fazla 5 MB olabilir."), { statusCode: 422 });
  }
  const isJpeg = file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  const isPng = file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = file.buffer.subarray(0, 4).toString("ascii") === "RIFF" && file.buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const signatureOk = (file.type === "image/jpeg" && isJpeg) || (file.type === "image/png" && isPng) || (file.type === "image/webp" && isWebp);
  if (!signatureOk) {
    throw Object.assign(new Error("Görsel dosyası doğrulanamadı. Lütfen geçerli bir jpg, png veya webp yükleyin."), { statusCode: 422 });
  }
  return expectedExt;
}

async function saveImages(propertyId, files, title) {
  if (files.length > maxImagesPerProperty) {
    throw Object.assign(new Error(`En fazla ${maxImagesPerProperty} fotoğraf yüklenebilir.`), { statusCode: 422 });
  }
  const dir = path.join(uploadDir, propertyId);
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (const [index, file] of files.entries()) {
    const ext = ensureAllowedImage(file);
    const id = crypto.randomUUID();
    const fileName = `${Date.now()}-${index}-${id}${ext}`;
    await fs.writeFile(path.join(dir, fileName), file.buffer, { flag: "wx" });
    saved.push({
      id,
      url: `/uploads/properties/${propertyId}/${fileName}`,
      alt: `${title} fotoğrafı`,
      sortOrder: index,
      createdAt: new Date().toISOString()
    });
  }
  return saved;
}

async function removePropertyFiles(property, imageIds) {
  const removable = property.images.filter((image) => imageIds.includes(image.id) && image.url.startsWith("/uploads/"));
  await Promise.all(removable.map((image) => fs.rm(path.join(rootDir, image.url), { force: true }).catch(() => undefined)));
}

function toArrayField(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === "") return [];
  return [value];
}

async function buildPropertyFromFields(fields, files, currentProperty = null) {
  const now = new Date().toISOString();
  const title = cleanText(fields.title, 180);
  const description = cleanMultiline(fields.description, 5000);
  const listingType = allowedListingTypes.has(fields.listingType) ? fields.listingType : "";
  const propertyType = allowedPropertyTypes.has(fields.propertyType) ? fields.propertyType : "";
  const status = allowedStatuses.has(fields.status) ? fields.status : "passive";
  const currency = allowedCurrencies.has(fields.currency) ? fields.currency : "TL";
  const errors = [];
  if (!title) errors.push("İlan başlığı zorunludur.");
  if (!listingType) errors.push("İlan tipi seçin.");
  if (!propertyType) errors.push("Gayrimenkul türü seçin.");
  if (!description) errors.push("Açıklama zorunludur.");
  if (!cleanText(fields.city, 80) || !cleanText(fields.district, 80)) errors.push("İl ve ilçe zorunludur.");
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join(" ")), { statusCode: 422 });
  }

  const id = currentProperty?.id || crypto.randomUUID();
  const deleteImageIds = toArrayField(fields.deleteImages);
  const remainingImages = currentProperty ? currentProperty.images.filter((image) => !deleteImageIds.includes(image.id)) : [];
  if (remainingImages.length + files.length > maxImagesPerProperty) {
    throw Object.assign(new Error(`Bir ilanda en fazla ${maxImagesPerProperty} fotoğraf olabilir.`), { statusCode: 422 });
  }
  if (currentProperty) await removePropertyFiles(currentProperty, deleteImageIds);
  const uploadedImages = await saveImages(id, files, title);
  const images = [...remainingImages, ...uploadedImages].map((image, index) => ({ ...image, sortOrder: index }));
  if (images.length < 1) errors.push("En az 1 fotoğraf yükleyin.");
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join(" ")), { statusCode: 422 });
  }

  const slugBase = cleanText(fields.slug, 180) || title;
  const slug = await uniqueSlug(slugBase, id);
  const coverImageId = cleanText(fields.coverImageId, 80);
  const coverUploadIndex = Number.parseInt(fields.coverUploadIndex || "", 10);
  const selectedCover = images.find((image) => image.id === coverImageId)
    || (Number.isInteger(coverUploadIndex) ? uploadedImages[coverUploadIndex] : null)
    || images[0];
  const roomCount = cleanText(fields.roomCount, 40);
  const neighborhood = cleanText(fields.neighborhood, 80);
  const district = cleanText(fields.district, 80);
  const listingLabel = displayType(listingType);
  const typeLabel = displayType(propertyType);
  const seoTitle = cleanText(fields.seoTitle, 180) || `${district} ${neighborhood} ${roomCount} ${listingLabel} ${typeLabel}`.replace(/\s+/g, " ").trim();
  const seoDescription = cleanText(fields.seoDescription, 260)
    || `${district} ${neighborhood} bölgesinde ${roomCount ? `${roomCount} ` : ""}${listingLabel.toLocaleLowerCase("tr-TR")} ${typeLabel.toLocaleLowerCase("tr-TR")} ilanını inceleyin. Fiyat, konum ve detaylı bilgi için hemen iletişime geçin.`;

  return {
    id,
    title,
    slug,
    listingType,
    propertyType,
    price: cleanText(fields.price, 40),
    currency,
    city: cleanText(fields.city, 80),
    district,
    neighborhood,
    addressDetail: cleanText(fields.addressDetail, 300),
    grossM2: cleanText(fields.grossM2, 20),
    netM2: cleanText(fields.netM2, 20),
    roomCount,
    salonCount: cleanText(fields.salonCount, 20),
    buildingAge: cleanText(fields.buildingAge, 40),
    floor: cleanText(fields.floor, 40),
    totalFloors: cleanText(fields.totalFloors, 20),
    heating: cleanText(fields.heating, 80),
    bathroomCount: cleanText(fields.bathroomCount, 20),
    hasBalcony: fields.hasBalcony === "on",
    isFurnished: fields.isFurnished === "on",
    dues: cleanText(fields.dues, 40),
    creditEligible: fields.creditEligible === "on",
    swapAvailable: fields.swapAvailable === "on",
    description,
    coverImage: selectedCover.url,
    seoTitle,
    seoDescription,
    status,
    featured: Boolean(currentProperty?.featured),
    images,
    createdAt: currentProperty?.createdAt || now,
    updatedAt: now
  };
}

async function handleApi(req, res, url) {
  if (!checkRateLimit(req)) {
    sendJson(res, 429, errorEnvelope("Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin."));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, envelope({ status: "ok", uptime: process.uptime() }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/brand") {
    sendJson(res, 200, envelope(await readJson("brand.json")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/properties") {
    const properties = await readProperties();
    const status = cleanText(url.searchParams.get("status") || "").toLocaleLowerCase("tr-TR");
    const type = cleanText(url.searchParams.get("type") || "").toLocaleLowerCase("tr-TR");
    const featured = url.searchParams.get("featured");

    const filtered = properties.filter((property) => {
      const legacyStatusOk = !status || property.status === status || property.listingType === status;
      const typeOk = !type || String(property.propertyType).toLocaleLowerCase("tr-TR") === type || property.listingType === type;
      const featuredOk = featured === null || String(Boolean(property.featured)) === featured;
      return legacyStatusOk && typeOk && featuredOk;
    });

    sendJson(res, 200, envelope(filtered, { total: filtered.length }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const projects = await readProjects();
    sendJson(res, 200, envelope(projects, { total: projects.length }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/appointments") {
    const lead = validateLead(await readBody(req), ["name", "phone"]);
    sendJson(res, 201, envelope(await appendSubmission("appointments", lead)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/valuation-requests") {
    const lead = validateLead(await readBody(req), ["name", "phone", "location"]);
    sendJson(res, 201, envelope(await appendSubmission("valuationRequests", lead)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/contact-requests") {
    const lead = validateLead(await readBody(req), []);
    if (!lead.email && !lead.phone) {
      throw Object.assign(new Error("Telefon veya e-posta bilgisi zorunludur."), {
        statusCode: 422,
        details: { missing: ["phoneOrEmail"] }
      });
    }
    sendJson(res, 201, envelope(await appendSubmission("contactRequests", lead)));
    return;
  }

  sendJson(res, 404, errorEnvelope("API endpoint bulunamadı."));
}

async function renderRobots(req, res) {
  sendText(res, 200, [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    `Sitemap: ${absoluteUrl(req, "/sitemap.xml")}`,
    ""
  ].join("\n"));
}

async function renderSitemap(req, res) {
  const staticUrls = [
    "/evimiz-sahane",
    "/projelerimiz",
    "/degerleme",
    "/kentsel-donusum",
    "/hakkimizda",
    "/iletisim",
    "/kvkk",
    "/cerez-politikasi"
  ];
  const projectUrls = (await readProjects())
    .filter((project) => project.slug)
    .map(projectDetailHref);
  const urls = [...staticUrls, ...projectUrls];
  const now = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((pathname) => `  <url>
    <loc>${escapeXml(absoluteUrl(req, pathname))}</loc>
    <lastmod>${now}</lastmod>
  </url>`).join("\n")}
</urlset>
`;
  sendText(res, 200, body, "application/xml; charset=utf-8");
}

function baseHead(title, description = "Evimiz Şahane güncel emlak ilanları", extraHead = "") {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700;800&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@200..700,0..1&display=block" rel="stylesheet">
<link rel="stylesheet" href="/assets/evimiz-tailwind.css?v=20260704-4">
<link rel="stylesheet" href="/assets/evimiz-redesign.css?v=20260704-4">
<script src="/assets/backend-client.js?v=20260704-4" defer></script>
<script src="/assets/evimiz-redesign.js?v=20260704-4" defer></script>
<style>
body{font-family:"Instrument Sans",Inter,sans-serif;background:#fff;color:#151515}
.material-symbols-outlined{display:inline-block;width:1em;overflow:hidden;font-family:"Material Symbols Outlined";font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;line-height:1;text-transform:none;white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:.5rem;padding:.78rem 1rem;font-weight:700;transition:.15s ease}
.btn:active{transform:scale(.98)}
.btn-primary{background:#000;color:#fff}
.btn-accent,.btn-blue{background:#f4540c;color:#fff}
.btn-wa{background:#25D366;color:#fff}
.card{background:#fff;border:1px solid #dedede;border-radius:.75rem;box-shadow:0 18px 45px rgba(17,17,17,.08)}
.field{display:flex;flex-direction:column;gap:.35rem}
.field label{font-size:.86rem;font-weight:700;color:#5f6268}
.field input,.field select,.field textarea{border:1px solid #dedede;border-radius:.5rem;background:#fff;padding:.75rem;min-width:0}
.field textarea{min-height:150px}
.badge{display:inline-flex;align-items:center;border-radius:.5rem;padding:.25rem .55rem;font-size:.78rem;font-weight:800}
.admin-table{min-width:980px}
@media(max-width:760px){.mobile-sticky-cta{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:1px solid #dedede;padding:.75rem}.admin-table-wrap{overflow-x:auto}}
</style>
${extraHead}
</head>`;
}

function siteHeader(active = "projeler") {
  const current = (key) => active === key ? ' aria-current="page"' : "";
  return `<div class="site-drawer-overlay" data-site-drawer-overlay></div>
<aside class="site-drawer" data-site-drawer aria-label="Mobil menü">
<div class="site-drawer__top"><a class="brand-lockup" href="/evimiz-sahane"><img src="/assets/logo-evimiz-sahane.svg" alt="Evimiz Şahane"></a><button class="icon-button material-symbols-outlined" type="button" data-site-menu-close aria-label="Menüyü kapat">close</button></div>
<nav>
<a href="/hakkimizda" data-nav-link><span class="material-symbols-outlined">domain</span>Kurumsal</a>
<a href="/kentsel-donusum" data-nav-link><span class="material-symbols-outlined">apartment</span>Kentsel Dönüşüm</a>
<a href="/projelerimiz" data-nav-link><span class="material-symbols-outlined">view_in_ar</span>Projelerimiz</a>
<a href="/evimiz-sahane#teknik-surec" data-scroll-target="#teknik-surec"><span class="material-symbols-outlined">architecture</span>Teknik Süreç</a>
<a href="/iletisim" data-nav-link><span class="material-symbols-outlined">mail</span>İletişim</a>
</nav>
<div class="site-drawer__actions"><a class="button button--orange" href="tel:+902129842633">Ara</a><a class="button button--whatsapp" href="https://wa.me/902129842633">WhatsApp</a></div>
</aside>
<header class="site-header">
<a class="brand-lockup" href="/evimiz-sahane" aria-label="Evimiz Şahane ana sayfa"><img src="/assets/logo-evimiz-sahane.svg" alt="Evimiz Şahane"></a>
<nav class="site-nav" aria-label="Ana menü">
<a href="/hakkimizda" data-nav-link${current("kurumsal")}>Kurumsal</a>
<a href="/kentsel-donusum" data-nav-link${current("kentsel")}>Kentsel Dönüşüm</a>
<a href="/projelerimiz" data-nav-link${current("projeler")}>Projelerimiz</a>
<a href="/evimiz-sahane#teknik-surec" data-scroll-target="#teknik-surec">Teknik Süreç</a>
<a href="/iletisim" data-nav-link${current("iletisim")}>İletişim</a>
</nav>
<div class="site-actions"><a class="button" href="/iletisim">Proje Görüşmesi Al <span class="material-symbols-outlined">arrow_forward</span></a><button class="icon-button mobile-menu-button material-symbols-outlined" type="button" data-site-menu-open aria-label="Menüyü aç">menu</button></div>
</header>`;
}

function siteFooter() {
  return `<footer class="site-footer">
<div class="site-footer__brand">
<a class="brand-lockup" href="/evimiz-sahane"><img src="/assets/logo-evimiz-sahane.svg" alt="Evimiz Şahane"></a>
<p class="site-footer__summary">Evimiz Şahane; kentsel dönüşüm, mimari proje geliştirme ve uygulama koordinasyonunu kurumsal inşaat disipliniyle yürütür.</p>
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
<a href="tel:+902129842633">0 (212) 984 26 33</a>
<a href="mailto:info@evimizsahane.com">info@evimizsahane.com</a>
<a href="https://wa.me/902129842633">WhatsApp</a>
<span>Avcılar Merkez Mah. Ahmet Taner Kışlalı Cad. No: 23 İç Kapı No: 3 Avcılar/İstanbul</span>
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

function adminNav() {
  return `<header class="sticky top-0 z-30 border-b border-[#c6c6cd] bg-white">
<div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
<a href="/admin/ilanlar" class="text-lg font-extrabold text-black">Evimiz Şahane Admin</a>
<nav class="flex items-center gap-2">
<a class="btn btn-accent py-2" href="/admin/ilan-ekle"><span class="material-symbols-outlined text-base">add</span>Yeni İlan</a>
<a class="btn border border-[#c6c6cd] bg-white py-2" href="/admin/ilanlar">İlanlar</a>
<a class="btn border border-[#c6c6cd] bg-white py-2" href="/admin/logout">Çıkış</a>
</nav>
</div>
</header>`;
}

async function renderLogin(req, res, error = "") {
  const admins = await ensureEnvAdmin();
  const setupNotice = admins.length === 0
    ? `<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Henüz admin kullanıcısı yok. Terminalde <code>ADMIN_USERNAME=admin ADMIN_PASSWORD='güçlü-şifre' node scripts/create-admin.js</code> komutuyla ilk kullanıcıyı oluşturun.</div>`
    : "";
  sendHtml(res, 200, `${baseHead("Admin Giriş | Evimiz Şahane")}
<body class="min-h-screen bg-[#fafafa]">
<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
<div class="card p-6">
<div class="mb-6">
<p class="text-sm font-bold uppercase text-[#f4540c]">Admin Panel</p>
<h1 class="text-2xl font-extrabold text-black">Giriş Yap</h1>
</div>
${setupNotice}
${error ? `<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">${escapeHtml(error)}</div>` : ""}
<form method="post" action="/admin/login" class="grid gap-4">
<div class="field"><label for="identity">E-posta veya kullanıcı adı</label><input id="identity" name="identity" autocomplete="username" required></div>
<div class="field"><label for="password">Şifre</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
<button class="btn btn-primary w-full" type="submit">Giriş yap</button>
</form>
</div>
</main>
</body></html>`);
}

async function handleLoginPost(req, res) {
  const body = await parseUrlEncoded(req);
  const identity = cleanText(body.identity, 160).toLowerCase();
  const password = String(body.password || "");
  const admins = await ensureEnvAdmin();
  const admin = admins.find((user) => user.username.toLowerCase() === identity || user.email.toLowerCase() === identity);
  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    await renderLogin(req, res, "Kullanıcı adı/e-posta veya şifre hatalı.");
    return;
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: admin.id,
    role: admin.role,
    csrfToken: crypto.randomBytes(24).toString("hex"),
    expiresAt: Date.now() + adminSessionMs
  });
  sendRedirect(res, "/admin/ilanlar", { "set-cookie": `admin_session=${encodeURIComponent(token)}; ${cookieFlags(req, adminSessionMs / 1000)}` });
}

async function renderAdminList(req, res, url) {
  const session = requireAdmin(req, res);
  if (!session) return;
  const properties = (await readProperties()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const status = cleanText(url.searchParams.get("status") || "");
  const listingType = cleanText(url.searchParams.get("listingType") || "");
  const q = cleanText(url.searchParams.get("q") || "").toLocaleLowerCase("tr-TR");
  const filtered = properties.filter((property) => {
    const statusOk = !status || property.status === status;
    const listingOk = !listingType || property.listingType === listingType;
    const qOk = !q || [property.title, property.district, property.neighborhood].some((value) => String(value).toLocaleLowerCase("tr-TR").includes(q));
    return statusOk && listingOk && qOk;
  });
  const rows = filtered.map((property) => `<tr class="border-t border-[#e2e8f0]">
<td class="p-3"><img src="${escapeHtml(property.coverImage)}" alt="" class="h-16 w-24 rounded object-cover"></td>
<td class="p-3 font-bold">${escapeHtml(property.title)}</td>
<td class="p-3">${displayType(property.listingType)}</td>
<td class="p-3">${escapeHtml(displayType(property.propertyType))}</td>
<td class="p-3">${escapeHtml(priceText(property))}</td>
<td class="p-3">${escapeHtml([property.neighborhood, property.district, property.city].filter(Boolean).join(" / "))}</td>
<td class="p-3"><span class="badge bg-[#fff0e8] text-[#9f2d00]">${displayType(property.status)}</span></td>
<td class="p-3">${escapeHtml(new Date(property.createdAt).toLocaleDateString("tr-TR"))}</td>
<td class="p-3"><div class="flex gap-2"><a class="btn btn-accent py-2" href="/admin/ilan-duzenle/${encodeURIComponent(property.id)}">Düzenle</a></div></td>
<td class="p-3">
<form method="post" action="/admin/ilan-pasife-al/${encodeURIComponent(property.id)}" onsubmit="return confirm('İlan pasife alınsın mı?')">
<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
<button class="btn border border-[#c6c6cd] bg-white py-2" type="submit">Pasife al</button>
</form>
</td>
</tr>`).join("");
  sendHtml(res, 200, `${baseHead("Admin İlanlar | Evimiz Şahane")}
<body>${adminNav()}
<main class="mx-auto max-w-7xl px-4 py-6">
<div class="mb-5 flex flex-wrap items-end justify-between gap-4">
<div><p class="text-sm font-bold uppercase text-[#f4540c]">Portföy Yönetimi</p><h1 class="text-3xl font-extrabold">İlanlar</h1></div>
<a class="btn btn-primary" href="/admin/ilan-ekle"><span class="material-symbols-outlined">add</span>Yeni İlan Ekle</a>
</div>
<form class="card mb-5 grid gap-3 p-4 md:grid-cols-4" method="get">
<div class="field"><label>Arama</label><input name="q" value="${escapeHtml(q)}" placeholder="Başlık, ilçe, mahalle"></div>
<div class="field"><label>Durum</label><select name="status"><option value="">Tümü</option>${["active", "passive", "sold", "rented"].map((item) => `<option value="${item}" ${status === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
<div class="field"><label>İlan tipi</label><select name="listingType"><option value="">Tümü</option>${["satilik", "kiralik"].map((item) => `<option value="${item}" ${listingType === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
<button class="btn btn-accent self-end" type="submit">Filtrele</button>
</form>
<div class="card admin-table-wrap overflow-hidden">
<table class="admin-table w-full text-left text-sm">
<thead class="bg-[#fff0e8] text-[#45464d]"><tr><th class="p-3">Kapak</th><th class="p-3">Başlık</th><th class="p-3">Tip</th><th class="p-3">Kategori</th><th class="p-3">Fiyat</th><th class="p-3">Konum</th><th class="p-3">Durum</th><th class="p-3">Yayın</th><th class="p-3">İşlem</th><th class="p-3"></th></tr></thead>
<tbody>${rows || `<tr><td class="p-6 text-center text-[#45464d]" colspan="10">İlan bulunamadı.</td></tr>`}</tbody>
</table>
</div>
</main></body></html>`);
}

function fieldValue(property, key) {
  return escapeHtml(property?.[key] || "");
}

function checked(property, key) {
  return property?.[key] ? "checked" : "";
}

function renderPropertyForm(session, property = null, error = "") {
  const isEdit = Boolean(property);
  const imageRows = property?.images?.map((image) => `<label class="flex items-center gap-3 rounded-lg border border-[#c6c6cd] bg-white p-2">
<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" class="h-20 w-28 rounded object-cover">
<span class="flex-1 text-sm">${escapeHtml(image.alt)}</span>
<span class="text-sm"><input type="radio" name="coverImageId" value="${escapeHtml(image.id)}" ${property.coverImage === image.url ? "checked" : ""}> Kapak</span>
<span class="text-sm"><input type="checkbox" name="deleteImages" value="${escapeHtml(image.id)}"> Sil</span>
</label>`).join("") || "";
  return `${baseHead(`${isEdit ? "İlan Düzenle" : "İlan Ekle"} | Evimiz Şahane`)}
<body>${adminNav()}
<main class="mx-auto max-w-5xl px-4 py-6">
<div class="mb-5"><p class="text-sm font-bold uppercase text-[#f4540c]">Portföy Yönetimi</p><h1 class="text-3xl font-extrabold">${isEdit ? "İlan Düzenle" : "Yeni İlan Ekle"}</h1></div>
${error ? `<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">${escapeHtml(error)}</div>` : ""}
<form class="grid gap-5" method="post" enctype="multipart/form-data" action="${isEdit ? `/admin/ilan-duzenle/${encodeURIComponent(property.id)}` : "/admin/ilan-ekle"}">
<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
<section class="card grid gap-4 p-4 md:grid-cols-2"><h2 class="md:col-span-2 text-xl font-extrabold">Temel Bilgiler</h2>
<div class="field md:col-span-2"><label>İlan başlığı *</label><input name="title" required value="${fieldValue(property, "title")}"></div>
<div class="field"><label>İlan tipi *</label><select name="listingType" required>${["satilik", "kiralik"].map((item) => `<option value="${item}" ${property?.listingType === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
<div class="field"><label>Gayrimenkul türü *</label><select name="propertyType" required>${["daire", "villa", "arsa", "isyeri", "dubleks", "residence", "mustakil_ev"].map((item) => `<option value="${item}" ${property?.propertyType === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
<div class="field"><label>Fiyat</label><input name="price" value="${fieldValue(property, "price")}" placeholder="4.750.000"></div>
<div class="field"><label>Para birimi</label><select name="currency">${["TL", "USD", "EUR"].map((item) => `<option value="${item}" ${property?.currency === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
<div class="field"><label>İlan durumu</label><select name="status">${["active", "passive", "sold", "rented"].map((item) => `<option value="${item}" ${property?.status === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
</section>
<section class="card grid gap-4 p-4 md:grid-cols-3"><h2 class="md:col-span-3 text-xl font-extrabold">Konum Bilgileri</h2>
<div class="field"><label>İl *</label><input name="city" required value="${fieldValue(property, "city") || "İstanbul"}"></div>
<div class="field"><label>İlçe *</label><input name="district" required value="${fieldValue(property, "district")}"></div>
<div class="field"><label>Mahalle</label><input name="neighborhood" value="${fieldValue(property, "neighborhood")}"></div>
<div class="field md:col-span-3"><label>Açık adres / konum açıklaması</label><input name="addressDetail" value="${fieldValue(property, "addressDetail")}"></div>
</section>
<section class="card grid gap-4 p-4 md:grid-cols-4"><h2 class="md:col-span-4 text-xl font-extrabold">Gayrimenkul Özellikleri</h2>
${[
  ["grossM2", "Brüt metrekare"], ["netM2", "Net metrekare"], ["roomCount", "Oda sayısı"], ["salonCount", "Salon sayısı"],
  ["buildingAge", "Bina yaşı"], ["floor", "Bulunduğu kat"], ["totalFloors", "Toplam kat"], ["heating", "Isıtma tipi"],
  ["bathroomCount", "Banyo sayısı"], ["dues", "Aidat"]
].map(([name, label]) => `<div class="field"><label>${label}</label><input name="${name}" value="${fieldValue(property, name)}"></div>`).join("")}
<label class="flex items-center gap-2"><input type="checkbox" name="hasBalcony" ${checked(property, "hasBalcony")}> Balkon var</label>
<label class="flex items-center gap-2"><input type="checkbox" name="isFurnished" ${checked(property, "isFurnished")}> Eşyalı</label>
<label class="flex items-center gap-2"><input type="checkbox" name="creditEligible" ${checked(property, "creditEligible")}> Krediye uygun</label>
<label class="flex items-center gap-2"><input type="checkbox" name="swapAvailable" ${checked(property, "swapAvailable")}> Takas olur</label>
</section>
<section class="card grid gap-4 p-4"><h2 class="text-xl font-extrabold">Açıklama</h2>
<div class="field"><label>İlan açıklaması *</label><textarea name="description" required>${escapeHtml(property?.description || "")}</textarea></div>
</section>
<section class="card grid gap-4 p-4"><h2 class="text-xl font-extrabold">Fotoğraflar</h2>
${imageRows ? `<div class="grid gap-2">${imageRows}</div>` : ""}
<div class="field"><label>Yeni fotoğraflar ${isEdit ? "" : "*"}</label><input name="images" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple ${isEdit ? "" : "required"}></div>
<div class="field"><label>Yeni yüklenenlerden kapak görseli</label><select name="coverUploadIndex"><option value="">İlk uygun fotoğraf</option>${Array.from({ length: 20 }, (_, index) => `<option value="${index}">${index + 1}. yeni fotoğraf</option>`).join("")}</select></div>
<p class="text-sm text-[#45464d]">En fazla 20 fotoğraf, her biri 5 MB. İzin verilen formatlar: jpg, jpeg, png, webp.</p>
</section>
<section class="card grid gap-4 p-4 md:grid-cols-2"><h2 class="md:col-span-2 text-xl font-extrabold">SEO Alanları</h2>
<div class="field"><label>SEO başlığı</label><input name="seoTitle" value="${fieldValue(property, "seoTitle")}"></div>
<div class="field"><label>Slug</label><input name="slug" value="${fieldValue(property, "slug")}"></div>
<div class="field md:col-span-2"><label>Meta açıklama</label><input name="seoDescription" value="${fieldValue(property, "seoDescription")}"></div>
</section>
<div class="flex flex-wrap gap-3"><button class="btn btn-primary" type="submit">${isEdit ? "Güncelle" : "İlanı Yayına Hazırla"}</button><a class="btn border border-[#c6c6cd] bg-white" href="/admin/ilanlar">Vazgeç</a></div>
</form>
</main></body></html>`;
}

async function handlePropertyForm(req, res, id = "") {
  const session = requireAdmin(req, res);
  if (!session) return;
  const isEdit = Boolean(id);
  const properties = await readProperties();
  const currentProperty = isEdit ? properties.find((property) => property.id === id) : null;
  if (isEdit && !currentProperty) {
    sendHtml(res, 404, `${baseHead("İlan bulunamadı")}<body>${adminNav()}<main class="p-6">İlan bulunamadı.</main></body></html>`);
    return;
  }
  try {
    const { fields, files } = await parseMultipart(req);
    validateCsrf(session, fields.csrf);
    const property = await buildPropertyFromFields(fields, files.filter((file) => file.field === "images"), currentProperty);
    const next = isEdit
      ? properties.map((item) => (item.id === property.id ? property : item))
      : [...properties, property];
    await writeProperties(next);
    sendRedirect(res, `/admin/ilanlar?ok=${isEdit ? "updated" : "created"}`);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) throw error;
    sendHtml(res, statusCode, renderPropertyForm(session, currentProperty, error.message));
  }
}

async function handlePassive(req, res, id) {
  const session = requireAdmin(req, res);
  if (!session) return;
  const fields = await parseUrlEncoded(req);
  validateCsrf(session, fields.csrf);
  const properties = await readProperties();
  const now = new Date().toISOString();
  await writeProperties(properties.map((property) => property.id === id ? { ...property, status: "passive", updatedAt: now } : property));
  sendRedirect(res, "/admin/ilanlar?ok=passive");
}

async function handleAdmin(req, res, url) {
  if (req.method === "GET" && url.pathname === "/admin") {
    sendRedirect(res, "/admin/ilanlar");
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/login") {
    await renderLogin(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/admin/login") {
    await handleLoginPost(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/logout") {
    const token = parseCookies(req).admin_session;
    if (token) sessions.delete(token);
    sendRedirect(res, "/admin/login", { "set-cookie": `admin_session=; ${cookieFlags(req, 0)}` });
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/ilanlar") {
    await renderAdminList(req, res, url);
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/ilan-ekle") {
    const session = requireAdmin(req, res);
    if (session) sendHtml(res, 200, renderPropertyForm(session));
    return;
  }
  if (req.method === "POST" && url.pathname === "/admin/ilan-ekle") {
    await handlePropertyForm(req, res);
    return;
  }
  const editMatch = url.pathname.match(/^\/admin\/ilan-duzenle\/([^/]+)$/);
  if (editMatch && req.method === "GET") {
    const session = requireAdmin(req, res);
    if (!session) return;
    const property = (await readProperties()).find((item) => item.id === decodeURIComponent(editMatch[1]));
    if (!property) {
      sendHtml(res, 404, `${baseHead("İlan bulunamadı")}<body>${adminNav()}<main class="p-6">İlan bulunamadı.</main></body></html>`);
      return;
    }
    sendHtml(res, 200, renderPropertyForm(session, property));
    return;
  }
  if (editMatch && req.method === "POST") {
    await handlePropertyForm(req, res, decodeURIComponent(editMatch[1]));
    return;
  }
  const passiveMatch = url.pathname.match(/^\/admin\/ilan-pasife-al\/([^/]+)$/);
  if (passiveMatch && req.method === "POST") {
    await handlePassive(req, res, decodeURIComponent(passiveMatch[1]));
    return;
  }
  sendHtml(res, 404, `${baseHead("Admin sayfası bulunamadı")}<body>Admin sayfası bulunamadı.</body></html>`);
}

function filterPublicProperties(properties, url) {
  const listingType = cleanText(url.searchParams.get("listingType") || "");
  const propertyType = cleanText(url.searchParams.get("propertyType") || "");
  const district = cleanText(url.searchParams.get("district") || "").toLocaleLowerCase("tr-TR");
  const roomCount = cleanText(url.searchParams.get("roomCount") || "");
  const minPrice = Number(cleanText(url.searchParams.get("minPrice") || "").replace(/\D/g, ""));
  const maxPrice = Number(cleanText(url.searchParams.get("maxPrice") || "").replace(/\D/g, ""));
  return properties.filter((property) => {
    const statusOk = isPublicListing(property);
    const listingOk = !listingType || property.listingType === listingType;
    const typeOk = !propertyType || slugify(property.propertyType) === propertyType || property.propertyType === propertyType;
    const districtOk = !district || property.district.toLocaleLowerCase("tr-TR").includes(district);
    const roomOk = !roomCount || property.roomCount === roomCount;
    const priceNumber = Number(String(property.price).replace(/\D/g, ""));
    const minOk = !minPrice || priceNumber >= minPrice;
    const maxOk = !maxPrice || priceNumber <= maxPrice;
    return statusOk && listingOk && typeOk && districtOk && roomOk && minOk && maxOk;
  });
}

async function renderProjectsPortfolio(req, res) {
  const projects = await readProjects();
  const firstProject = projects[0];
  const totalImages = projects.reduce((sum, project) => sum + (Array.isArray(project.galeri) ? project.galeri.length : 0), 0);
  const projectStats = [
    [String(projects.length), "yayındaki proje"],
    [String(totalImages), "optimize WebP görsel"],
    ["3", "bölge odaklı proje grubu"]
  ];
  const cards = projects.map((project, index) => {
    const detailHref = projectDetailHref(project);
    const images = Array.isArray(project.galeri) ? project.galeri.slice(0, 3) : [];
    return `<a class="portfolio-case" href="${escapeHtml(detailHref)}">
<div class="portfolio-case__media">
<img src="${escapeHtml(project.kapak_gorsel)}" alt="${escapeHtml(project.ad)}" width="${escapeHtml(project.kapak_boyut?.width || "")}" height="${escapeHtml(project.kapak_boyut?.height || "")}" loading="${index === 0 ? "eager" : "lazy"}">
${images.length > 1 ? `<div class="portfolio-case__thumbs">${images.slice(1).map((image) => `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || project.ad)}" width="${escapeHtml(image.width || "")}" height="${escapeHtml(image.height || "")}" loading="lazy">`).join("")}</div>` : ""}
</div>
<div class="portfolio-case__body">
<span class="portfolio-index">${String(index + 1).padStart(2, "0")}</span>
<h2>${escapeHtml(project.ad)}</h2>
<p>${escapeHtml(project.ozet_meta_aciklama || project.aciklama)}</p>
<dl>
<div><dt>Lokasyon</dt><dd>${escapeHtml([project.ilce, "İstanbul"].filter(Boolean).join(" / "))}</dd></div>
<div><dt>Kapsam</dt><dd>${escapeHtml((project.daire_tipleri || []).join(", ") || "[Kapsam bilgisi eklenecek]")}</dd></div>
<div><dt>Durum</dt><dd>${escapeHtml(projectStatusLabel(project.durum))}</dd></div>
</dl>
</div>
</a>`;
  }).join("");
  const title = "Projelerimiz | Evimiz Şahane";
  const description = "Evimiz Şahane proje portföyü: kentsel dönüşüm, konut, villa ve yaşam alanı geliştirme çalışmalarımız.";
  const canonical = absoluteUrl(req, "/projelerimiz");
  const seoHead = `<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(absolutePublicUrl(req, firstProject?.kapak_gorsel || "/assets/projects/avcilar-residence-01.jpeg"))}">`;
  sendHtml(res, 200, `${baseHead(title, description, seoHead)}
<body class="brand-site">${siteHeader("projeler")}
<main>
<section class="portfolio-hero">
<div class="shell portfolio-hero__grid">
<div>
<p class="page-kicker">Projelerimiz</p>
<h1>Yalnızca portföy değil, teslim disiplini.</h1>
<p>Evimiz Şahane projeleri; doğru fizibilite, mimari karakter, mühendislik koordinasyonu ve malik güveniyle büyüyen işlerdir. Burada odağımız metrekare satışı değil, yaptığımız işin ölçeği ve kalitesidir.</p>
<div class="portfolio-stats">${projectStats.map(([value, label]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>
</div>
<figure><img src="${escapeHtml(firstProject?.kapak_gorsel || "/assets/projects/avcilar-residence-01.jpeg")}" alt="Evimiz Şahane proje portföyü" width="${escapeHtml(firstProject?.kapak_boyut?.width || "")}" height="${escapeHtml(firstProject?.kapak_boyut?.height || "")}"></figure>
</div>
</section>
<section class="section">
<div class="shell portfolio-cases">${cards || `<div class="info-card">Henüz yayınlanmış proje bulunamadı.</div>`}</div>
</section>
<section class="section section--black">
<div class="shell dark-panel">
<div><h2>İnşaat ve kentsel dönüşüm ana odağımızdır.</h2><p>Projelerimiz sayfası satış ilanı gibi değil, tamamladığımız ve geliştirdiğimiz işlerin kurumsal portföyü olarak kurgulanmıştır.</p></div>
<ul class="subtle-list">
<li><span class="material-symbols-outlined">check_circle</span>Fizibilite, mimari proje, ruhsat ve uygulama koordinasyonu tek akışta yönetilir.</li>
<li><span class="material-symbols-outlined">check_circle</span>Her proje; teknik doküman, malzeme kararı ve teslim takvimiyle izlenir.</li>
<li><span class="material-symbols-outlined">check_circle</span>Admin ilanları ayrı sayfada tutulur; proje portföyü kurumsal vitrin olarak kalır.</li>
</ul>
</div>
</section>
<section class="contact-band">
<div class="contact-band__sketch" aria-hidden="true"></div>
<div class="contact-band__copy"><h2>Sıradaki projeyi birlikte planlayalım.</h2><p>Arsanız, binanız veya dönüşüm fikriniz için teknik ve ticari yol haritasını birlikte çıkaralım.</p><a class="button button--light" href="/iletisim">Proje Görüşmesi Al</a></div>
<div class="contact-band__details"><div class="contact-line"><span class="material-symbols-outlined">phone</span><div><strong>Telefon</strong><a href="tel:+902129842633">0 (212) 984 26 33</a></div></div><div class="contact-line"><span class="material-symbols-outlined">location_on</span><div><strong>Merkez</strong><span>Avcılar / İstanbul</span></div></div></div>
</section>
</main>${siteFooter()}</body></html>`);
}

function renderPolicyPage(req, res, page) {
  const isCookies = page === "cookies";
  const title = isCookies ? "Çerez Politikası | Evimiz Şahane" : "KVKK Aydınlatma Metni | Evimiz Şahane";
  const description = isCookies
    ? "Evimiz Şahane web sitesinde kullanılan zorunlu ve analitik çerezlere ilişkin bilgilendirme."
    : "Evimiz Şahane iletişim ve proje görüşmesi taleplerinde kişisel verilerin işlenmesine ilişkin aydınlatma metni.";
  const pathname = isCookies ? "/cerez-politikasi" : "/kvkk";
  const canonical = absoluteUrl(req, pathname);
  const paragraphs = isCookies
    ? [
      "Bu web sitesinde temel site güvenliği, form gönderimi ve performans takibi için zorunlu teknik çerezler kullanılabilir.",
      "Analitik veya pazarlama amaçlı ek araçlar devreye alınırsa kullanıcı bilgilendirmesi ve tercih yönetimi ayrıca sağlanır.",
      "Çerez tercihleri ve kişisel veri talepleri için Evimiz Şahane ile iletişim kanallarımızdan ulaşabilirsiniz."
    ]
    : [
      "Evimiz Şahane, iletişim ve proje görüşmesi formları üzerinden ilettiğiniz ad, soyad, telefon, e-posta, konum ve mesaj bilgilerini talebinize dönüş yapabilmek amacıyla işler.",
      "Kişisel verileriniz yetkisiz kişilerle paylaşılmaz; yasal zorunluluklar ve hizmetin yürütülmesi için gerekli haller dışında üçüncü taraflara aktarılmaz.",
      "KVKK kapsamındaki bilgi, düzeltme ve silme talepleriniz için info@evimizsahane.com adresinden bizimle iletişime geçebilirsiniz."
    ];
  const seoHead = `<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonical)}">`;
  sendHtml(res, 200, `${baseHead(title, description, seoHead)}
<body class="brand-site">${siteHeader("")}
<main>
<section class="page-hero shell">
<div>
<p class="page-kicker">${isCookies ? "Çerezler" : "KVKK"}</p>
<h1>${isCookies ? "Çerez Politikası" : "KVKK Aydınlatma Metni"}</h1>
${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
</div>
<img src="/assets/projects/avcilar-residence-03.jpeg" alt="Evimiz Şahane proje görseli">
</section>
</main>${siteFooter()}</body></html>`);
}

function staticPathParts(urlPathname) {
  try {
    return decodeURIComponent(urlPathname).split(/[\\/]+/).filter(Boolean);
  } catch {
    return null;
  }
}

function isPrivateStaticPath(urlPathname) {
  const parts = staticPathParts(urlPathname);
  if (!parts || parts.some((part) => part.startsWith("."))) return true;
  if (parts[0] === "uploads" && parts[1] === "properties") return false;
  return privateStaticRoots.has(parts[0]);
}

function safeStaticPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.join(rootDir, normalized);
  return absolute.startsWith(rootDir) ? absolute : null;
}

async function serveStatic(req, res, url) {
  if (url.pathname === "/") {
    sendRedirect(res, "/evimiz-sahane");
    return;
  }

  if (url.pathname === "/evimiz-sahane") {
    url.pathname = "/ana_sayfa_elite_estates/code.html";
  }

  if (url.pathname === "/hakkimizda_elite_estates") {
    sendRedirect(res, "/hakkimizda", {}, 301);
    return;
  }

  if (url.pathname === "/i_leti_im_ve_randevu_elite_estates") {
    sendRedirect(res, "/iletisim", {}, 301);
    return;
  }

  if (url.pathname === "/evimi_sat_kirala_cretsiz_de_erleme") {
    sendRedirect(res, "/degerleme", {}, 301);
    return;
  }

  if (url.pathname === "/kentsel_donusum") {
    sendRedirect(res, "/kentsel-donusum", {}, 301);
    return;
  }

  if (url.pathname === "/portf_y_ve_i_lanlar_elite_estates") {
    sendRedirect(res, "/projelerimiz", {}, 301);
    return;
  }

  if (url.pathname === "/i_lan_detay_elite_estates") {
    sendRedirect(res, "/projelerimiz", {}, 301);
    return;
  }

  if (url.pathname === "/evimi-sat-kirala-ucretsiz-degerleme") {
    sendRedirect(res, "/degerleme", {}, 301);
    return;
  }

  if (url.pathname === "/hakkimizda") {
    url.pathname = "/hakkimizda_elite_estates/code.html";
  }

  if (url.pathname === "/iletisim") {
    url.pathname = "/i_leti_im_ve_randevu_elite_estates/code.html";
  }

  if (url.pathname === "/degerleme") {
    url.pathname = "/evimi_sat_kirala_cretsiz_de_erleme/code.html";
  }

  if (url.pathname === "/kentsel-donusum") {
    url.pathname = "/kentsel_donusum/code.html";
  }

  if (isPrivateStaticPath(url.pathname)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const filePath = safeStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const resolved = stat.isDirectory() ? path.join(filePath, "code.html") : filePath;
    const ext = path.extname(resolved).toLowerCase();
    if (url.pathname.startsWith("/uploads/properties/") && ![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const body = ext === ".html"
      ? rewriteStaticHtmlOrigins(await fs.readFile(resolved, "utf8"), req)
      : await fs.readFile(resolved);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function requestHandler(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/robots.txt") {
      await renderRobots(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/sitemap.xml") {
      await renderSitemap(req, res);
      return;
    }
    if (url.pathname.startsWith("/admin")) {
      await handleAdmin(req, res, url);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/projelerimiz" || url.pathname === "/projeler")) {
      await renderProjectsPortfolio(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/kvkk") {
      renderPolicyPage(req, res, "kvkk");
      return;
    }
    if (req.method === "GET" && url.pathname === "/cerez-politikasi") {
      renderPolicyPage(req, res, "cookies");
      return;
    }
    const projectCleanMatch = url.pathname.match(/^\/projeler\/([^/.]+)$/);
    if (req.method === "GET" && projectCleanMatch) {
      sendRedirect(res, `/projeler/${encodeURIComponent(decodeURIComponent(projectCleanMatch[1]))}.html`);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode >= 500 ? "Sunucu hatası oluştu." : error.message;
    if (statusCode >= 500) console.error(error);
    if (url.pathname.startsWith("/api/")) sendJson(res, statusCode, errorEnvelope(message, error.details));
    else sendHtml(res, statusCode, `${baseHead("Hata")}<body><main class="mx-auto max-w-3xl p-6"><div class="card p-6">${escapeHtml(message)}</div></main></body></html>`);
  }
}

if (require.main === module) {
  http.createServer(requestHandler).listen(port, () => {
    console.log(`Evimiz Şahane backend hazır: http://localhost:${port}`);
  });
}

Object.assign(requestHandler, {
  cleanEmail,
  cleanPhone,
  cleanText,
  hashPassword,
  normalizeProperty,
  requestHandler,
  slugify,
  validateLead,
  verifyPassword
});

module.exports = requestHandler;
