const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads", "properties");
const port = Number.parseInt(process.env.PORT || "3000", 10);
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

function envelope(data, meta) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

function errorEnvelope(message, details) {
  return { success: false, error: message, ...(details ? { details } : {}) };
}

function siteOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000").split(",")[0].trim();
  return `${proto}://${host}`;
}

function absoluteUrl(req, pathname) {
  return new URL(pathname, siteOrigin(req)).toString();
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
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
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

function sendRedirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers });
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
    const raw = await fs.readFile(path.join(dataDir, fileName), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJson(fileName, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, fileName), `${JSON.stringify(value, null, 2)}\n`);
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
    "/ilanlar",
    "/evimi_sat_kirala_cretsiz_de_erleme",
    "/kentsel-donusum",
    "/hakkimizda_elite_estates",
    "/i_leti_im_ve_randevu_elite_estates"
  ];
  const properties = (await readProperties())
    .filter((property) => property.status === "active")
    .map((property) => `/ilan/${property.slug}`);
  const urls = [...staticUrls, ...properties];
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
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/evimiz-redesign.css?v=20260703-5">
<script src="/assets/evimiz-redesign.js?v=20260703-5" defer></script>
<style>
body{font-family:Inter,sans-serif;background:#fafafa;color:#232323}
.material-symbols-outlined{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;line-height:1}
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

function siteHeader(active = "ilanlar") {
  return `<header class="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#c6c6cd] bg-white px-4 shadow-sm">
<a href="/evimiz-sahane" class="flex items-center gap-3 text-black">
<span class="flex h-11 w-11 items-center justify-center border border-[#c6c6cd] bg-white text-3xl font-bold">e</span>
<span class="text-xl font-extrabold">Evimiz Şahane</span>
</a>
<nav class="hidden items-center gap-6 md:flex">
<a class="${active === "ilanlar" ? "text-[#f4540c] font-bold" : "text-[#5f6268]"}" href="/ilanlar">Portfolyomuz</a>
<a class="text-[#45464d]" href="/evimi_sat_kirala_cretsiz_de_erleme">Evimi Sat</a>
<a class="text-[#45464d]" href="/kentsel_donusum">Kentsel Dönüşüm</a>
<a class="text-[#45464d]" href="/hakkimizda_elite_estates">Hakkımızda</a>
<a class="text-[#45464d]" href="/i_leti_im_ve_randevu_elite_estates">İletişim</a>
</nav>
<a class="btn btn-accent hidden md:inline-flex" href="tel:+902129842633">Ara</a>
</header>`;
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
<td class="p-3"><div class="flex gap-2"><a class="btn btn-accent py-2" href="/admin/ilan-duzenle/${encodeURIComponent(property.id)}">Düzenle</a><a class="btn border border-[#c6c6cd] bg-white py-2" href="/ilan/${encodeURIComponent(property.slug)}" target="_blank" rel="noopener">Sitede Gör</a></div></td>
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
    const statusOk = property.status === "active";
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

async function renderPublicList(req, res, url) {
  const properties = filterPublicProperties(await readProperties(), url).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const districts = [...new Set((await readProperties()).map((property) => property.district).filter(Boolean))].sort();
  const cards = properties.map((property) => {
    const message = encodeURIComponent(`Merhaba, sitenizdeki ${property.title} ilanı hakkında bilgi almak istiyorum.`);
    return `<article class="card group overflow-hidden">
<a href="/ilan/${encodeURIComponent(property.slug)}" class="block">
<div class="relative aspect-[4/3] overflow-hidden bg-[#fff0e8]"><img src="${escapeHtml(property.coverImage)}" alt="${escapeHtml(property.title)}" class="h-full w-full object-cover transition duration-500 group-hover:scale-105">
<span class="badge absolute right-3 top-3 bg-white/95 text-black">${displayType(property.listingType)}</span>
<span class="badge absolute left-3 top-3 bg-[#f4540c] text-white">${escapeHtml(displayType(property.propertyType))}</span></div>
<div class="grid gap-3 p-4">
<h2 class="text-lg font-extrabold text-black">${escapeHtml(property.title)}</h2>
<p class="text-2xl font-extrabold text-[#f4540c]">${escapeHtml(priceText(property))}</p>
<p class="flex items-center gap-1 text-sm text-[#45464d]"><span class="material-symbols-outlined text-base">location_on</span>${escapeHtml([property.neighborhood, property.district].filter(Boolean).join(" / "))}</p>
<div class="grid grid-cols-3 border-y border-[#e2e8f0] py-3 text-center text-sm"><span>${escapeHtml(property.grossM2 || "-")} m²</span><span class="border-x border-[#e2e8f0]">${escapeHtml(property.roomCount || "-")}</span><span>${escapeHtml(displayType(property.propertyType))}</span></div>
</div></a>
<div class="grid grid-cols-[1fr_auto] gap-2 px-4 pb-4"><a class="btn btn-primary" href="/ilan/${encodeURIComponent(property.slug)}">Detayları Gör</a><a class="btn btn-wa px-3" aria-label="WhatsApp'tan bilgi al" href="https://wa.me/902129842633?text=${message}"><span class="material-symbols-outlined">chat</span></a></div>
</article>`;
  }).join("");
  const title = "Evimiz Şahane - Güncel Satılık ve Kiralık Portföyler";
  const description = "Evimiz Şahane aktif satılık ve kiralık portföylerini konum, fiyat ve oda kriterlerine göre inceleyin.";
  const canonical = absoluteUrl(req, "/ilanlar");
  const seoHead = `<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonical)}">`;
  sendHtml(res, 200, `${baseHead(title, description, seoHead)}
<body class="pb-8">${siteHeader("ilanlar")}
<main class="mx-auto max-w-7xl px-4 py-6">
<section class="mb-6">
<h1 class="mb-2 text-3xl font-extrabold md:text-4xl">Güncel Satılık ve Kiralık Portföyler</h1>
<p class="max-w-2xl text-[#45464d]">Evimiz Şahane özel seçkisiyle aktif portföyleri inceleyin ve tek dokunuşla iletişime geçin.</p>
</section>
<form class="card mb-6 grid gap-3 p-4 md:grid-cols-6" method="get">
<div class="field"><label>Satılık / Kiralık</label><select name="listingType"><option value="">Tümü</option>${["satilik", "kiralik"].map((item) => `<option value="${item}" ${url.searchParams.get("listingType") === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
<div class="field"><label>Tür</label><select name="propertyType"><option value="">Tümü</option>${["daire", "villa", "arsa", "isyeri", "dubleks", "residence", "mustakil_ev"].map((item) => `<option value="${item}" ${url.searchParams.get("propertyType") === item ? "selected" : ""}>${displayType(item)}</option>`).join("")}</select></div>
<div class="field"><label>İlçe</label><select name="district"><option value="">Tümü</option>${districts.map((item) => `<option value="${escapeHtml(item)}" ${url.searchParams.get("district") === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}</select></div>
<div class="field"><label>Oda</label><input name="roomCount" value="${escapeHtml(url.searchParams.get("roomCount") || "")}" placeholder="3+1"></div>
<div class="field"><label>Min fiyat</label><input name="minPrice" inputmode="numeric" value="${escapeHtml(url.searchParams.get("minPrice") || "")}"></div>
<button class="btn btn-accent self-end" type="submit">Filtrele</button>
</form>
<div class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">${cards || `<div class="card p-6 text-center text-[#45464d] md:col-span-2 lg:col-span-3">Aktif ilan bulunamadı.</div>`}</div>
</main></body></html>`);
}

async function renderPropertyDetail(req, res, slug) {
  const properties = await readProperties();
  const property = properties.find((item) => item.slug === slug && item.status === "active");
  if (!property) {
    sendHtml(res, 404, `${baseHead("İlan bulunamadı")}<body>${siteHeader("ilanlar")}<main class="mx-auto max-w-3xl p-6">İlan bulunamadı.</main></body></html>`);
    return;
  }
  const brand = await readJson("brand.json", {});
  const phoneHref = brand.contact?.phoneHref || "+902129842633";
  const whatsappHref = brand.contact?.whatsappHref || "902129842633";
  const message = encodeURIComponent(`Merhaba, sitenizdeki ${property.title} ilanı hakkında bilgi almak istiyorum.`);
  const canonical = absoluteUrl(req, `/ilan/${property.slug}`);
  const gallery = property.images.map((image) => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || property.title)}" class="h-28 w-full rounded-lg object-cover md:h-36">`).join("");
  const similar = properties.filter((item) => item.id !== property.id && item.status === "active" && (item.propertyType === property.propertyType || item.district === property.district)).slice(0, 3);
  const similarHtml = similar.map((item) => `<a class="card grid grid-cols-[96px_1fr] gap-3 p-2" href="/ilan/${encodeURIComponent(item.slug)}"><img src="${escapeHtml(item.coverImage)}" alt="" class="h-24 w-24 rounded object-cover"><span><strong class="block">${escapeHtml(item.title)}</strong><span class="text-sm text-[#45464d]">${escapeHtml(priceText(item))}</span></span></a>`).join("");
  const seoHead = `<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(property.seoTitle || property.title)}">
<meta property="og:description" content="${escapeHtml(property.seoDescription)}">
<meta property="og:image" content="${escapeHtml(property.coverImage)}">`;
  sendHtml(res, 200, `${baseHead(property.seoTitle || property.title, property.seoDescription, seoHead)}
<body class="pb-24 md:pb-8">${siteHeader("ilanlar")}
<main class="mx-auto max-w-7xl px-4 py-6">
<div class="grid gap-6 lg:grid-cols-[1.4fr_.8fr]">
<section class="grid gap-4">
<img src="${escapeHtml(property.coverImage)}" alt="${escapeHtml(property.title)}" class="aspect-[16/10] w-full rounded-xl object-cover">
<div class="grid grid-cols-3 gap-2 md:grid-cols-5">${gallery}</div>
<article class="card grid gap-4 p-5"><div><span class="badge bg-[#fff0e8] text-[#9f2d00]">${displayType(property.listingType)}</span><h1 class="mt-3 text-3xl font-extrabold">${escapeHtml(property.title)}</h1><p class="mt-2 text-3xl font-extrabold text-[#f4540c]">${escapeHtml(priceText(property))}</p><p class="mt-2 text-[#45464d]">${escapeHtml([property.neighborhood, property.district, property.city].filter(Boolean).join(" / "))}</p></div>
<div class="grid grid-cols-2 gap-3 md:grid-cols-4">${[
  ["m²", property.grossM2], ["Oda", property.roomCount], ["Banyo", property.bathroomCount], ["Kat", property.floor],
  ["Isıtma", property.heating], ["Balkon", property.hasBalcony ? "Var" : "Yok"], ["Eşyalı", property.isFurnished ? "Evet" : "Hayır"], ["Kredi", property.creditEligible ? "Uygun" : "Belirtilmedi"]
].map(([label, value]) => `<div class="rounded-lg bg-[#fff0e8] p-3"><span class="block text-xs font-bold text-[#45464d]">${label}</span><strong>${escapeHtml(value || "-")}</strong></div>`).join("")}</div>
<div class="prose max-w-none leading-7">${textToParagraphs(property.description)}</div></article>
</section>
<aside class="grid content-start gap-4">
<div class="card grid gap-3 p-5"><h2 class="text-xl font-extrabold">Bu ilanla ilgileniyorum</h2><a class="btn btn-wa" href="https://wa.me/${escapeHtml(whatsappHref)}?text=${message}"><span class="material-symbols-outlined">chat</span>WhatsApp'tan Bilgi Al</a><a class="btn btn-primary" href="tel:${escapeHtml(phoneHref)}"><span class="material-symbols-outlined">phone</span>Telefonla Ara</a></div>
${similarHtml ? `<div class="grid gap-3"><h2 class="text-xl font-extrabold">Benzer İlanlar</h2>${similarHtml}</div>` : ""}
</aside>
</div>
</main>
<div class="mobile-sticky-cta grid grid-cols-2 gap-2 md:hidden"><a class="btn btn-wa" href="https://wa.me/${escapeHtml(whatsappHref)}?text=${message}">WhatsApp</a><a class="btn btn-primary" href="tel:${escapeHtml(phoneHref)}">Ara</a></div>
</body></html>`);
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

  if (url.pathname === "/portf_y_ve_i_lanlar_elite_estates") {
    sendRedirect(res, "/ilanlar");
    return;
  }

  if (url.pathname === "/i_lan_detay_elite_estates") {
    sendRedirect(res, "/ilanlar");
    return;
  }

  if (url.pathname === "/kentsel-donusum" || url.pathname === "/kentsel_donusum") {
    url.pathname = "/kentsel_donusum/code.html";
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
    const body = await fs.readFile(resolved);
    res.writeHead(200, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
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
    if (req.method === "GET" && url.pathname === "/ilanlar") {
      await renderPublicList(req, res, url);
      return;
    }
    const detailMatch = url.pathname.match(/^\/ilan\/([^/]+)$/);
    if (req.method === "GET" && detailMatch) {
      await renderPropertyDetail(req, res, decodeURIComponent(detailMatch[1]));
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

module.exports = {
  cleanEmail,
  cleanPhone,
  cleanText,
  hashPassword,
  normalizeProperty,
  requestHandler,
  slugify,
  validateLead,
  verifyPassword
};
