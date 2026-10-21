import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_DIR = path.join(__dirname, 'images');
const DATA_FILE = path.join(__dirname, 'tenders.json');

// Klasör yoksa oluştur
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  console.log(`📁 '${IMAGES_DIR}' klasörü oluşturuldu.`);
}

if (!fs.existsSync(DATA_FILE)) {
  console.error('❌ tenders.json bulunamadı!');
  process.exit(1);
}

const raw = fs.readFileSync(DATA_FILE, 'utf-8');
const tenders = JSON.parse(raw);
const list = Array.isArray(tenders) ? tenders : tenders.tenders || [];

console.log(`🚀 Toplam ${list.length} adet ihale bulundu. Kapak fotoğrafları indiriliyor...\n`);

async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function run() {
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const firstItem = t.items?.[0] || {};
    let photoUrl = firstItem.medias?.[0]?.mediumPath || firstItem.medias?.[0]?.path || t.thumbnail;

    if (!photoUrl) {
      skipped++;
      continue;
    }

    // large görsel linkine dönüştür (eğer small/medium varsa en kaliteli large'a çek)
    const largeUrl = photoUrl.replace('/image/small/', '/image/large/').replace('/image/medium/', '/image/large/');
    const fileName = `${t.id || 'ilan_' + i}.jpg`;
    const destPath = path.join(IMAGES_DIR, fileName);

    // Eğer zaten inmişse tekrar indirme
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
      skipped++;
      continue;
    }

    try {
      // Önce large dene, olmazsa orijinal url dene
      let size = 0;
      try {
        size = await downloadImage(largeUrl, destPath);
      } catch (err) {
        size = await downloadImage(photoUrl, destPath);
      }
      downloaded++;
      console.log(`[${i + 1}/${list.length}] ✅ İndirildi: ${fileName} (${(size / 1024).toFixed(1)} KB) - ${t.title || 'İlan'}`);
    } catch (err) {
      failed++;
      console.warn(`[${i + 1}/${list.length}] ❌ Hata (${fileName}): ${err.message}`);
    }

    // Sunucuyu boğmamak için kısa bekleme (50ms)
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n🎉 İşlem tamamlandı!`);
  console.log(`✅ Yeni İndirilen: ${downloaded}`);
  console.log(`⏩ Atlanan (Mevcut/Görselsiz): ${skipped}`);
  console.log(`❌ Başarısız: ${failed}`);
  console.log(`📁 Görseller şurada saklandı: ${IMAGES_DIR}`);
}

run();
