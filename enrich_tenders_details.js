import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'tenders.json');

if (!fs.existsSync(DATA_FILE)) {
  console.error('❌ tenders.json bulunamadı!');
  process.exit(1);
}

const raw = fs.readFileSync(DATA_FILE, 'utf-8');
const tenders = JSON.parse(raw);
const list = Array.isArray(tenders) ? tenders : tenders.tenders || [];

// Sadece eksik olanları veya henüz realPrice / priceGuarantee çekilmemiş olanları seç
const pending = list.filter(t => !t.realPrice || !t.priceGuarantee);

console.log(`🚀 Toplam ${list.length} ilanın ${pending.length} tanesinde 'Satışa Esas Bedel' ve 'Teminat Bedeli' eksik.`);
if (pending.length === 0) {
  console.log('✅ Tüm ilanlar zaten güncel!');
  process.exit(0);
}

async function run() {
  console.log('[Detay Çekici] Tarayıcı başlatılıyor...');
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Resim, font, css engelleyerek aşırı hızlı yükleme sağla
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  let latestBigData = null;
  page.on('response', async res => {
    if (res.url().includes('/api/app/tender/big')) {
      try {
        const json = await res.json();
        if (json && (json.tenderNumber || json.id)) {
          latestBigData = json;
        }
      } catch (e) {}
    }
  });

  let updatedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const code = item.shortCode || item.id;
    const url = `https://eihale.gov.tr/ihaleler/detay/${code}`;

    latestBigData = null;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

      // API cevabını bekle (max 4 sn)
      for (let w = 0; w < 40; w++) {
        if (latestBigData) break;
        await new Promise(r => setTimeout(r, 100));
      }

      if (latestBigData) {
        // İlana detay alanlarını ekle
        item.realPrice = latestBigData.realPrice ?? null;                 // Satışa Esas Bedel
        item.priceGuarantee = latestBigData.priceGuarantee ?? null;       // Teminat Bedeli
        item.startingPrice = latestBigData.startingPrice ?? item.price;   // Başlangıç Bedeli
        item.storeName = latestBigData.storeName || item.storeName || ''; // Bulunduğu Yer / Depo
        item.startDate = latestBigData.startDate || item.startDate || ''; // Teklif Başlangıç Tarihi
        item.minIncreaseAmount = latestBigData.minIncreaseAmount ?? 500;  // Asgari Artış Tutarı

        updatedCount++;
        console.log(`[${i + 1}/${pending.length}] ✅ ${item.title || code} | Satışa Esas: ${Number(item.realPrice).toLocaleString('tr-TR')} ₺ | Teminat: ${Number(item.priceGuarantee).toLocaleString('tr-TR')} ₺`);
      } else {
        console.warn(`[${i + 1}/${pending.length}] ⚠️ Detay API yanıt vermedi: ${code}`);
        errorCount++;
      }
    } catch (err) {
      console.error(`[${i + 1}/${pending.length}] ❌ Hata (${code}):`, err.message);
      errorCount++;
    }

    // Her 10 ilanda bir diske kaydet (veri kaybını önlemek için)
    if ((i + 1) % 10 === 0 || i === pending.length - 1) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
      console.log(`💾 [Ara Kayıt] tenders.json güncellendi (${updatedCount} güncel ilan).`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  await browser.close();
  console.log(`\n🎉 Detay tamamlama bitti! Toplam Güncellenen: ${updatedCount}, Hatalı: ${errorCount}`);
}

run();
