const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { cleanEmail, cleanText, hashPassword } = require("../server");

const rootDir = path.join(__dirname, "..");
const adminFile = path.join(rootDir, "data", "admin-users.json");

async function readAdmins() {
  try {
    return JSON.parse(await fs.readFile(adminFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const username = cleanText(process.env.ADMIN_USERNAME || "", 80);
  const email = cleanEmail(process.env.ADMIN_EMAIL || "admin@evimizsahane.local");
  const password = String(process.env.ADMIN_PASSWORD || "");

  if (!username || !password || password.length < 10) {
    throw new Error("ADMIN_USERNAME ve en az 10 karakterli ADMIN_PASSWORD ortam değişkenlerini verin.");
  }

  const admins = await readAdmins();
  if (admins.some((admin) => admin.username === username || admin.email === email)) {
    throw new Error("Bu kullanıcı adı veya e-posta ile admin zaten var.");
  }

  const now = new Date().toISOString();
  const next = [
    ...admins,
    {
      id: crypto.randomUUID(),
      username,
      email,
      passwordHash: hashPassword(password),
      role: "admin",
      createdAt: now,
      updatedAt: now
    }
  ];

  await fs.mkdir(path.dirname(adminFile), { recursive: true });
  await fs.writeFile(adminFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Admin kullanıcısı oluşturuldu: ${username}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
