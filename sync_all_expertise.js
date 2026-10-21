import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'tenders.json');
const REPORTS_DIR = path.join(__dirname, 'expertise_reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`İndirme başarısız: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

export async function processAllExpertises(limit = null, startIndex = 0) {
  let tenders = [];
  try {
    tenders = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('tenders.json okunamadı:', e.message);
    return;
  }

  const targets = limit ? tenders.slice(startIndex, startIndex + limit) : tenders.slice(startIndex);
  console.log(`\n[Ekspertiz Motoru] Toplam ${targets.length} adet ilan işlenecek (Başlangıç: ${startIndex})...\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Gereksiz resim ve fontları engelleyerek sayfayı 3-5 kat hızlandır
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  let successCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const tender = targets[i];
    const code = tender.shortCode || tender.id;
    const title = tender.title || 'İlan';
    const tenderNo = tender.tenderNumber || code;

    // Eğer zaten OCR yapılmışsa tekrar yapma
    if (tender.expertiseResult && tender.expertiseResult.findings && tender.expertiseResult.findings.length > 0) {
      console.log(`[${i + 1}/${targets.length}] ⏭️ Zaten var: ${title} (${tenderNo})`);
      skippedCount++;
      continue;
    }

    console.log(`[${i + 1}/${targets.length}] 🚗 İnceleniyor: ${title} (${tenderNo})`);

    let capturedDoc = null;
    let totalDocsCount = 0;

    const onResponse = async (res) => {
      if (res.url().includes('/tender/big')) {
        try {
          const json = await res.json();
          const item = json.items?.[0] || {};
          const medias = item.medias || item.media || [];
          const docs = medias.filter(m => m.itemMediaType === 3);
          totalDocsCount = docs.length;
          if (docs.length > 0) {
            // KURAL: 2. belge (ekspertiz sonucu) varsa docs[1], tek belge varsa docs[0]
            capturedDoc = docs.length > 1 ? docs[1] : docs[0];
          }
        } catch (e) {}
      }
    };

    page.on('response', onResponse);

    try {
      const detailUrl = tender.detailUrl || `https://eihale.gov.tr/ihaleler/detay/${code}`;
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      // Big API yanıtı gelene kadar kısa bekleme
      await new Promise(r => setTimeout(r, 1500));
    } catch (navErr) {
      console.log(`  ⚠️ Sayfa açılış timeout: ${navErr.message}`);
    } finally {
      page.off('response', onResponse);
    }

    if (!capturedDoc || !capturedDoc.path) {
      console.log(`  ⚪ Ekspertiz belgesi bulunamadı.`);
      continue;
    }

    console.log(`  📄 2. Ekspertiz belgesi tespit edildi (${totalDocsCount} belge içinden): ${capturedDoc.description}`);

    const safeName = `${tenderNo}_sonuc.jpg`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const localImgPath = path.join(REPORTS_DIR, safeName);

    try {
      // Görseli indir
      await downloadImage(capturedDoc.path, localImgPath);
      console.log(`  💾 İndirildi: ${safeName}`);

      // Python OCR scriptini çalıştır ve tenders.json'a kaydet
      const cmd = `python3 -c "import parse_expertise, json; res = parse_expertise.process_expertise_for_tender('${localImgPath}', '${code}'); print('OCR_OK' if res else 'OCR_FAIL')"`;
      const out = execSync(cmd, { cwd: __dirname, encoding: 'utf8' });

      if (out.includes('OCR_OK')) {
        console.log(`  ✅ OCR başarılı! Tespitler tenders.json'a kaydedildi.`);
        successCount++;
      } else {
        console.log(`  ⚠️ OCR çalıştı ancak tespit listesi boş.`);
      }
    } catch (err) {
      console.error(`  ❌ Hata: ${err.message}`);
    }

    // Kısa nefes alma
    await new Promise(r => setTimeout(r, 400));
  }

  await browser.close();

  console.log(`\n========================================`);
  console.log(`[Ekspertiz İşlemi Tamamlandı]`);
  console.log(`Toplam İncelenen: ${targets.length}`);
  console.log(`Önceden Mevcut Olan: ${skippedCount}`);
  console.log(`Yeni Başarılı OCR: ${successCount}`);
  console.log(`========================================\n`);
}

// Komut satırı argümanları: node sync_all_expertise.js [limit] [startIndex]
const argLimit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const argStart = process.argv[3] ? parseInt(process.argv[3], 10) : 0;

processAllExpertises(argLimit, argStart).catch(console.error);
