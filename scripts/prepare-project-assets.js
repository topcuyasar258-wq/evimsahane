const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const rootDir = path.join(__dirname, "..");
const desktopDir = path.join(os.homedir(), "Desktop");
const outputRoot = path.join(rootDir, "assets", "projects");
const dataFile = path.join(rootDir, "data", "projects.json");

const projects = [
  {
    slug: "selimpasa-64-daire",
    ad: "Selimpaşa 64 Daire",
    ilce: "Selimpaşa",
    kaynakKlasor: "selimpasa 64 daire",
    durum: "[Durum bilgisi eklenecek]",
    yil: "[Teslim yılı eklenecek]",
    m2: "[m² bilgisi eklenecek]",
    daire_tipleri: ["[Daire tipi bilgisi eklenecek]"],
    aciklama: "Selimpaşa 64 Daire projesi için kapsam, metrekare, teslim yılı ve teknik bilgiler eklenecek. Proje görsel arşivi yayına hazırlanmıştır.",
    konum: { lat: null, lng: null },
    ozet_meta_aciklama: "Selimpaşa 64 Daire projesi görselleri ve proje detayları. Evimiz Şahane proje portföyünü inceleyin.",
    once_gorsel: null,
    sira: [2, 5, 10, 3, 4, 6, 7, 8, 9, 1, 11]
  },
  {
    slug: "selimpasa-villa-projesi",
    ad: "Selimpaşa Villa Projesi",
    ilce: "Selimpaşa",
    kaynakKlasor: "selimpasa villa projesi",
    durum: "[Durum bilgisi eklenecek]",
    yil: "[Teslim yılı eklenecek]",
    m2: "[m² bilgisi eklenecek]",
    daire_tipleri: ["[Villa tipi bilgisi eklenecek]"],
    aciklama: "Selimpaşa Villa Projesi için konut tipi, metrekare, teslim yılı ve teknik kapsam bilgileri eklenecek. Proje görsel arşivi yayına hazırlanmıştır.",
    konum: { lat: null, lng: null },
    ozet_meta_aciklama: "Selimpaşa Villa Projesi görselleri ve proje detayları. Evimiz Şahane proje portföyünü inceleyin.",
    once_gorsel: null,
    sira: [8, 1, 10, 23, 3, 12, 18, 28, 29, 30, 31, 35, 2, 4, 5, 6, 7, 9, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 24, 25, 26, 27, 32, 33, 34, 36]
  },
  {
    slug: "silivri-ortakoy-villa",
    ad: "Silivri Ortaköy Villa",
    ilce: "Silivri Ortaköy",
    kaynakKlasor: "silivri ortakoy villa",
    durum: "[Durum bilgisi eklenecek]",
    yil: "[Teslim yılı eklenecek]",
    m2: "[m² bilgisi eklenecek]",
    daire_tipleri: ["[Villa tipi bilgisi eklenecek]"],
    aciklama: "Silivri Ortaköy Villa projesi için konut tipi, metrekare, teslim yılı ve teknik kapsam bilgileri eklenecek. Proje görsel arşivi yayına hazırlanmıştır.",
    konum: { lat: null, lng: null },
    ozet_meta_aciklama: "Silivri Ortaköy Villa projesi görselleri ve proje detayları. Evimiz Şahane proje portföyünü inceleyin.",
    once_gorsel: null,
    sira: [2, 1, 12, 18, 14, 15, 16, 17, 8, 9, 10, 11, 13, 19, 20, 21, 3, 4, 5, 6, 7]
  }
];

function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

async function findSourceDir(targetName) {
  const entries = await fs.readdir(desktopDir, { withFileTypes: true });
  const target = normalizeName(targetName);
  const match = entries.find((entry) => entry.isDirectory() && normalizeName(entry.name) === target);
  if (!match) {
    throw new Error(`Proje klasörü bulunamadı: ${targetName}`);
  }
  return path.join(desktopDir, match.name);
}

async function imageDimensions(filePath) {
  const metadata = await sharp(filePath).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0
  };
}

async function convertProject(project) {
  const sourceDir = await findSourceDir(project.kaynakKlasor);
  const sourceFiles = (await fs.readdir(sourceDir))
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort();
  const orderedFiles = project.sira
    .map((item) => sourceFiles[item - 1])
    .filter(Boolean);
  const missingFiles = sourceFiles.filter((name) => !orderedFiles.includes(name));
  const files = [...orderedFiles, ...missingFiles];
  const outputDir = path.join(outputRoot, project.slug);
  await fs.mkdir(outputDir, { recursive: true });

  const gallery = [];
  for (const [index, fileName] of files.entries()) {
    const sourceFile = path.join(sourceDir, fileName);
    const outputName = `${String(index + 1).padStart(2, "0")}.webp`;
    const outputFile = path.join(outputDir, outputName);
    await sharp(sourceFile)
      .rotate()
      .resize({ width: 1800, height: 1400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toFile(outputFile);
    const dimensions = await imageDimensions(outputFile);
    gallery.push({
      src: `/assets/projects/${project.slug}/${outputName}`,
      width: dimensions.width,
      height: dimensions.height,
      alt: `${project.ad} proje görseli ${index + 1}`
    });
  }

  const cover = gallery[0];
  return {
    slug: project.slug,
    ad: project.ad,
    ilce: project.ilce,
    durum: project.durum,
    yil: project.yil,
    m2: project.m2,
    daire_tipleri: project.daire_tipleri,
    aciklama: project.aciklama,
    kapak_gorsel: cover.src,
    kapak_boyut: { width: cover.width, height: cover.height },
    galeri: gallery,
    once_gorsel: project.once_gorsel,
    sonra_gorsel: cover.src,
    sonra_gorsel_boyut: { width: cover.width, height: cover.height },
    konum: project.konum,
    ozet_meta_aciklama: project.ozet_meta_aciklama
  };
}

async function main() {
  const data = [];
  for (const project of projects) {
    data.push(await convertProject(project));
  }
  await fs.writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Prepared ${data.length} projects in ${path.relative(rootDir, outputRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
