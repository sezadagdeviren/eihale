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

export async function processMissingExpertises(limit = null) {
  let tenders = [];
  try {
    tenders = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('tenders.json okunamadı:', e.message);
    return;
  }

  // SADECE EKSİK OLANLARI FİLTRELE (Ekspertiz sonucu hiç olmayan veya 0 madde olanlar)
  const missingTenders = tenders.filter(t => 
    !t.expertiseResult || 
    !t.expertiseResult.findings || 
    t.expertiseResult.findings.length === 0
  );

  const targets = limit ? missingTenders.slice(0, limit) : missingTenders;

  console.log(`\n======================================================`);
  console.log(`[Eksik Ekspertiz Tarayıcısı]`);
  console.log(`Toplam İlan Sayısı: ${tenders.length}`);
  console.log(`Eksik İlan Sayısı : ${missingTenders.length}`);
  console.log(`Bu Turda İşlenecek: ${targets.length}`);
  console.log(`======================================================\n`);

  if (targets.length === 0) {
    console.log('✅ Tebrikler! Tüm ilanların ekspertiz sonuçları zaten mevcut.');
    return;
  }

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

  // Sayfa açılışını hızlandır (resim ve fontları blokla)
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
  let notFoundCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const tender = targets[i];
    const code = tender.shortCode || tender.id;
    const title = tender.title || 'İlan';
    const tenderNo = tender.tenderNumber || code;

    console.log(`[${i + 1}/${targets.length}] 🚗 Eksik İnceleniyor: ${title} (${tenderNo})`);

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
      await new Promise(r => setTimeout(r, 1500));
    } catch (navErr) {
      console.log(`  ⚠️ Sayfa timeout: ${navErr.message}`);
    } finally {
      page.off('response', onResponse);
    }

    if (!capturedDoc || !capturedDoc.path) {
      console.log(`  ⚪ Ekspertiz belgesi bulunamadı.`);
      notFoundCount++;
      continue;
    }

    console.log(`  📄 2. Ekspertiz belgesi bulundu (${totalDocsCount} belge içinden): ${capturedDoc.description}`);

    const safeName = `${tenderNo}_sonuc.jpg`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const localImgPath = path.join(REPORTS_DIR, safeName);

    try {
      // Görseli indir
      await downloadImage(capturedDoc.path, localImgPath);

      // Python OCR scriptini çalıştır ve tenders.json'a kaydet
      const cmd = `python3 -c "import parse_expertise; res = parse_expertise.process_expertise_for_tender('${localImgPath}', '${tenderNo}'); print('OCR_OK' if res else 'OCR_FAIL')"`;
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

    await new Promise(r => setTimeout(r, 400));
  }

  await browser.close();

  console.log(`\n========================================`);
  console.log(`[Tamamlandı]`);
  console.log(`Hedeflenen Eksik İlan: ${targets.length}`);
  console.log(`Başarıyla OCR Yapılan: ${successCount}`);
  console.log(`Belgesi Olmayan      : ${notFoundCount}`);
  console.log(`========================================\n`);
}

// node sync_missing_expertise.js [limit]
const argLimit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
processMissingExpertises(argLimit).catch(console.error);
