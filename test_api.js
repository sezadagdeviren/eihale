import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
const page = await browser.newPage();

let captured = null;

// Tüm network response'ları logla
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('filter-with-lite') || url.includes('tender') || url.includes('ihale')) {
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json')) {
      try {
        const json = await response.json();
        console.log('\n📡 API URL:', url.split('?')[0]);
        console.log('📦 Top-level keys:', Object.keys(json));
        if (json.items && Array.isArray(json.items) && json.items.length > 0) {
          console.log('📋 items[0] keys:', Object.keys(json.items[0]));
          console.log('📋 items[0] örnek:', JSON.stringify(json.items[0]).slice(0, 500));
          if (json.items[0].items && json.items[0].items.length > 0) {
            console.log('📋 items[0].items[0] keys:', Object.keys(json.items[0].items[0]));
            console.log('📋 items[0].items[0]:', JSON.stringify(json.items[0].items[0]).slice(0, 500));
          }
          captured = json;
        }
      } catch (e) {}
    }
  }
});

const TARGET = 'https://eihale.gov.tr/?categoryId=cd02a1a7-4c0a-02dd-28e7-39f737373d83';
console.log('Sayfaya gidiliyor...');
await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 60000 });

// Kartların yüklenmesini bekle
await page.waitForFunction(() => document.querySelectorAll('a[href*="/detay/"]').length > 0, { timeout: 20000 }).catch(() => {});

if (!captured) {
  console.log('\n⚠️ API yanıtı yakalanmadı! Tüm network istekleri:');
  // Ham DOM'dan ne var bakalım
  const domText = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('a[href*="/detay/"]')).slice(0, 3);
    return cards.map(c => ({
      href: c.href,
      card: c.closest('mat-card, app-tender-card, .tender-card, [class*="card"]')?.innerText?.slice(0, 200)
    }));
  });
  console.log('DOM kartlar:', JSON.stringify(domText, null, 2));
}

await browser.close();
