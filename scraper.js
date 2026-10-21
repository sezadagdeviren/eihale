import puppeteer from 'puppeteer';

export async function scrapeVehicles() {
  console.log('[Scraper] Tarayıcı başlatılıyor...');

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
  await page.setViewport({ width: 1440, height: 900 });

  const allTendersMap = new Map();
  const apiTendersByTitle = new Map();
  const apiTendersById = new Map(); // id → parsed api item (daha güvenilir eşleşme)

  const TARGET_URL = 'https://eihale.gov.tr/?categoryId=cd02a1a7-4c0a-02dd-28e7-39f737373d83';

  // API response'unu düzgün bir nesneye dönüştür
  function parseApiItem(item) {
    const firstItem = item.items?.[0] || {};
    const attrs = firstItem.attributes || [];

    // attributes dizisini key→value map'e çevir
    const attrMap = {};
    attrs.forEach(a => {
      if (a.key) attrMap[a.key] = a.value || '';
    });

    const medias = firstItem.medias || firstItem.mediaList || [];
    const thumbnailFromAttr = medias[0]?.url || item.thumbnail || (item.mediaList && item.mediaList[0]) || '';

    // Başlık normalleştir: çift boşlukları tek yap (API "Tofaş  Kartal" → "Tofaş Kartal")
    const normalizedTitle = (item.title || '').replace(/\s+/g, ' ').trim();

    return {
      id: item.id || '',
      title: normalizedTitle,
      price: item.price || item.startingPrice || 0,     // Başlangıç bedeli (hem price hem startingPrice)
      publishedDate: item.publishedDate || '',
      endDate: item.endDate || '',
      thumbnail: thumbnailFromAttr,
      tenderNumber: item.tenderNumber || '',
      branchName: item.branchName || '',               // Bölge/Müdürlük
      branchId: item.branchId || '',
      tenderStatus: item.tenderStatus ?? 5,
      // Araç özellikleri (attributes'dan)
      modelYear: attrMap['Yıl'] || attrMap['Model Yılı'] || '',
      km: attrMap['Km'] || attrMap['KM'] || '',
      gear: attrMap['Vites'] || '',
      engineCC: attrMap['Motor Hacmi'] || '',
      fuel: attrMap['Yakıt'] || '',
      color: attrMap['Renk'] || '',
      brand: attrMap['Marka'] || '',
      model: attrMap['Model'] || '',
      plate: attrMap['Plaka'] || '',
      disposalReason: attrMap['Tasfiye Nedeni'] || '',
      extraObligation: attrMap['Ek Mali Yükümlülük'] || '',
      // Tüm ham attributes (beklenmedik alanlar için)
      attributes: attrMap,
    };
  }

  page.on('response', async (response) => {
    const url = response.url();
    // Featured dahil tüm filter-with-lite-items endpoint'lerini yakala
    if (url.includes('filter-with-lite-items')) {
      try {
        const json = await response.json();
        if (json && json.items && Array.isArray(json.items)) {
          json.items.forEach(item => {
            const parsed = parseApiItem(item);
            // Başlık key: normalleştirilmiş (çift boşluk → tek)
            const titleKey = parsed.title.replace(/\s+/g, ' ').trim().toLowerCase();
            if (titleKey) {
              apiTendersByTitle.set(titleKey, parsed);
            }
            // id ile de indexle
            if (parsed.id) {
              apiTendersById.set(parsed.id, parsed);
            }
          });
        }
      } catch (err) { }
    }
  });

  // DOM'daki kartlardan tüm ilan bilgilerini topla
  async function scrapeCardsFromDOM() {
    return await page.evaluate(() => {
      const linkElements = Array.from(document.querySelectorAll('a[href*="/detay/"]'));
      const seenCodes = new Set();
      const items = [];

      linkElements.forEach(linkEl => {
        const href = linkEl.href || '';
        const shortCode = href.match(/\/detay\/([^/?&#]+)/)?.[1] || '';
        if (!shortCode || seenCodes.has(shortCode)) return;
        seenCodes.add(shortCode);

        const card = linkEl.closest('mat-card, app-tender-card, .tender-card') || linkEl.parentElement;
        if (!card) return;

        const titleEl = card.querySelector('.title, mat-card-title, h3, .tender-title, a[href*="/detay/"]');
        const title = titleEl?.innerText?.trim() || 'Araç İhalesi';

        // Görsel: src, data-src ve mediaList fallback
        const imgs = Array.from(card.querySelectorAll('img'));
        const validImg = imgs.find(i => (i.src && !i.src.startsWith('data:') && !i.src.includes('placeholder')) || i.getAttribute('data-src'));
        const thumbnail = validImg ? (validImg.src || validImg.getAttribute('data-src') || '') : '';

        let price = 0;
        const text = card.innerText || '';
        const priceMatch = text.match(/(?:[₺TL\s]*)([\d\.]+)\s*(?:TL|₺)/i) || text.match(/Başlangıç Bedeli:\s*[\n\r\s]*[₺TL\s]*([\d\.]+)/i);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/\./g, ''), 10) || 0;
        }

        const noMatch = text.match(/(\d{4}[A-Z]{3}\d{4}[A-Z0-9]+)/);
        const tenderNumber = noMatch ? noMatch[1] : '';

        const branchMatch = text.match(/([A-ZÇĞİÖŞÜa-zçğıöşü\s\.]+T\.İ\.M\.|[A-ZÇĞİÖŞÜa-zçğıöşü\s]+Müdürlüğü)/);
        let branchName = branchMatch ? branchMatch[1].trim() : '';
        if (branchName.startsWith('on\n') || branchName.startsWith('on ')) {
          branchName = branchName.replace(/^on[\s\n]+/, '').trim();
        }

        items.push({
          id: shortCode,
          shortCode,
          detailUrl: `https://eihale.gov.tr/ihaleler/detay/${shortCode}`,
          title,
          thumbnail,
          price,
          tenderNumber,
          branchName,
          tenderStatus: 5
        });
      });

      return items;
    });
  }

  // Sayfalayıcı etiketinden toplam ilan sayısını ve sayfa sayısını çek
  async function getTotalPagesInfo() {
    return await page.evaluate(() => {
      const label = document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '';
      const match = label.match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/);
      if (!match) return null;
      const perPage = parseInt(match[2], 10) - parseInt(match[1], 10) + 1;
      const total = parseInt(match[3], 10);
      const totalPages = Math.ceil(total / perPage);
      return { total, perPage, totalPages, label };
    });
  }

  // Sayfanın tamamen hazır olmasını bekle (label + kartlar)
  async function waitForPageReady(expectedMinStart, timeoutMs = 20000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < timeoutMs) {
      attempt++;
      const rangeLabel = await page.evaluate(() =>
        document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || ''
      );
      const labelMatch = rangeLabel.match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/);
      const labelStartNum = labelMatch ? parseInt(labelMatch[1], 10) : 0;
      const domItems = await scrapeCardsFromDOM();

      const labelOk = labelMatch && labelStartNum >= expectedMinStart;
      const cardsOk = domItems.length >= 4;

      if (labelOk && cardsOk) {
        console.log(`[Scraper] ✅ Sayfa hazır | Label: "${rangeLabel}" | Kart: ${domItems.length} (deneme ${attempt})`);
        return { rangeLabel, domItems, ready: true };
      }

      if (attempt % 4 === 0) {
        console.log(`[Scraper] ⏳ Bekleniyor (${attempt}. deneme) | Label: "${rangeLabel}" | LabelOk:${labelOk} | LabelStart:${labelStartNum} | BeklenenMin:${expectedMinStart} | Kart:${domItems.length}`);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    // Timeout: son durumu döndür
    const rangeLabel = await page.evaluate(() =>
      document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || ''
    );
    const domItems = await scrapeCardsFromDOM();
    return { rangeLabel, domItems, ready: false };
  }

  // Ana sayfaya gidip ilk N sayfayı tıklayarak hedef sayfaya ulaş (DOM sıfırlanınca recovery)
  async function navigateToPageByClicking(targetPageNum, perPage) {
    console.log(`[Scraper] 🔁 Recovery: Ana sayfaya gidip sayfa ${targetPageNum}'e tıklayarak ulaşılıyor...`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // İlk sayfanın yüklenmesini bekle
    await page.waitForFunction(() => {
      const label = document.querySelector('.mat-paginator-range-label')?.innerText || '';
      const cards = document.querySelectorAll('a[href*="/detay/"]');
      return /\d+\s*-\s*\d+\s*\/\s*\d+/.test(label) && cards.length > 0;
    }, { timeout: 30000, polling: 300 }).catch(() => {});

    // Hedef sayfaya kadar tıkla
    for (let p = 1; p < targetPageNum; p++) {
      const expectedMin = (p - 1) * perPage + 1;

      // Önce bu sayfanın hazır olduğunu doğrula
      await waitForPageReady(expectedMin, 15000);

      // Butona tıkla
      let clicked = false;
      for (let r = 0; r < 15; r++) {
        clicked = await page.evaluate(() => {
          const btn = document.querySelector('.mat-paginator-navigation-next, [aria-label="Next page"], [aria-label="Sonraki sayfa"]');
          if (!btn) return false;
          const dis = btn.hasAttribute('disabled') || btn.classList.contains('mat-button-disabled') || btn.getAttribute('aria-disabled') === 'true' || btn.disabled;
          if (!dis) { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); btn.click(); return true; }
          return false;
        });
        if (clicked) break;
        await new Promise(r => setTimeout(r, 600));
      }

      if (!clicked) {
        console.log(`[Scraper] ⚠️ Recovery sırasında sayfa ${p}→${p + 1} tıklanamadı!`);
        break;
      }

      // Geçişi bekle
      const prevLabel = await page.evaluate(() => document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '');
      await page.waitForFunction((pl) => {
        const cur = document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '';
        return cur && cur !== pl && cur.includes('/');
      }, { timeout: 15000, polling: 150 }, prevLabel).catch(() => {});

      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`[Scraper] 🔁 Recovery tamamlandı, sayfa ${targetPageNum}'de olunması bekleniyor.`);
  }

  try {
    console.log(`[Scraper] Sayfaya gidiliyor: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // İlk sayfa hazır olana kadar bekle
    console.log('[Scraper] İlk sayfa yükleniyor, paginator bekleniyor...');
    await page.waitForFunction(() => {
      const label = document.querySelector('.mat-paginator-range-label')?.innerText || '';
      const cards = document.querySelectorAll('a[href*="/detay/"]');
      return /\d+\s*-\s*\d+\s*\/\s*\d+/.test(label) && cards.length > 0;
    }, { timeout: 30000, polling: 200 }).catch((e) => {
      console.log('[Scraper] ⚠️ İlk sayfa bekleme timeout:', e.message);
    });

    // Toplam sayfa sayısını öğren
    const pageInfo = await getTotalPagesInfo();
    if (pageInfo) {
      console.log(`[Scraper] ✅ Toplam ilan: ${pageInfo.total} | Sayfa başı: ${pageInfo.perPage} | Toplam sayfa: ${pageInfo.totalPages} | Label: "${pageInfo.label}"`);
    } else {
      console.log('[Scraper] ⚠️ Toplam sayfa bilgisi alınamadı, MAX_PAGES=50 ile devam ediliyor.');
    }

    const totalPages = pageInfo?.totalPages || 50;
    const perPage = pageInfo?.perPage || 12;
    let pageNum = 1;

    while (pageNum <= totalPages) {
      console.log(`\n[Scraper] ══════ SAYFA ${pageNum}/${totalPages} ══════`);

      const expectedMinStart = (pageNum - 1) * perPage + 1;

      // Sayfanın render olmasını bekle
      let { rangeLabel, domItems, ready } = await waitForPageReady(expectedMinStart, 20000);

      // Eğer DOM tamamen boşsa → recovery: ana sayfadan yeniden gezin
      if (!ready && domItems.length === 0) {
        console.log(`[Scraper] 🚨 DOM tamamen boş! Angular sayfayı sıfırlamış olabilir. Recovery başlatılıyor...`);
        await navigateToPageByClicking(pageNum, perPage);

        // Recovery sonrası tekrar bekle
        const result2 = await waitForPageReady(expectedMinStart, 20000);
        rangeLabel = result2.rangeLabel;
        domItems = result2.domItems;
        ready = result2.ready;

        if (!ready) {
          console.log(`[Scraper] ❌ Recovery sonrası da sayfa ${pageNum} yüklenemedi. Atlanıyor.`);
        }
      } else if (!ready && rangeLabel && rangeLabel.includes('/')) {
        // Label var ama yanlış sayfada (sayfa gerisinde kaldı) → hizala
        const lblMatch = rangeLabel.match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/);
        if (lblMatch) {
          const actualPageStart = parseInt(lblMatch[1], 10);
          const actualPage = Math.ceil(actualPageStart / perPage);
          const clicksNeeded = pageNum - actualPage;
          if (clicksNeeded > 0) {
            console.log(`[Scraper] 🔧 Sayfa senkronizasyonu: DOM sayfa ${actualPage} gösteriyor, hedef ${pageNum} → ${clicksNeeded} tıklama yapılıyor`);
            for (let ci = 0; ci < clicksNeeded; ci++) {
              const prevLbl = await page.evaluate(() => document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '');
              await page.evaluate(() => {
                const btn = document.querySelector('.mat-paginator-navigation-next, [aria-label="Next page"], [aria-label="Sonraki sayfa"]');
                if (btn && !btn.hasAttribute('disabled') && !btn.classList.contains('mat-button-disabled')) {
                  btn.scrollIntoView({ behavior: 'instant', block: 'center' }); btn.click();
                }
              });
              await page.waitForFunction((pl) => {
                const cur = document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '';
                return cur && cur !== pl && cur.includes('/');
              }, { timeout: 10000, polling: 150 }, prevLbl).catch(() => {});
              await new Promise(r => setTimeout(r, 2000));
            }
            // Hizalama sonrası yeniden oku
            const aligned = await waitForPageReady(expectedMinStart, 15000);
            rangeLabel = aligned.rangeLabel;
            domItems = aligned.domItems;
            console.log(`[Scraper] 🔧 Hizalama sonrası: Label="${rangeLabel}" | Kart=${domItems.length}`);
          } else {
            console.log(`[Scraper] ⚠️ Sayfa ${pageNum} tam hazır değil ama kart var, devam ediliyor.`);
          }
        }
      } else if (!ready) {
        console.log(`[Scraper] ⚠️ Sayfa ${pageNum} tam hazır değil ama kart var, devam ediliyor.`);
      }

      // Yeni kartları ekle
      let newAddedThisPage = 0;
      domItems.forEach(item => {
        if (item.shortCode && !allTendersMap.has(item.shortCode)) {
          allTendersMap.set(item.shortCode, item);
          newAddedThisPage++;
        }
      });

      console.log(`[Scraper] 📋 Sayfa ${pageNum}: Çekilen=${domItems.length} | Yeni=${newAddedThisPage} | ToplamTekil=${allTendersMap.size}`);

      // Son sayfa mı?
      if (pageNum >= totalPages) {
        console.log('[Scraper] 🏁 Toplam sayfa sayısına ulaşıldı.');
        break;
      }

      // Range label ile son sayfa güvenlik kontrolü
      const labelEndCheck = await page.evaluate(() => {
        const label = document.querySelector('.mat-paginator-range-label')?.innerText || '';
        const match = label.match(/(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)/);
        if (match) return { end: parseInt(match[2], 10), total: parseInt(match[3], 10) };
        return null;
      });
      if (labelEndCheck && labelEndCheck.end >= labelEndCheck.total) {
        console.log('[Scraper] 🏁 Range label son sayfayı gösteriyor.');
        break;
      }

      // Buton durumunu logla
      const btnState = await page.evaluate(() => {
        const btn = document.querySelector('.mat-paginator-navigation-next, [aria-label="Next page"], [aria-label="Sonraki sayfa"]');
        if (!btn) return { found: false };
        return {
          found: true,
          isDisabled: btn.hasAttribute('disabled') || btn.classList.contains('mat-button-disabled') || btn.getAttribute('aria-disabled') === 'true' || btn.disabled,
          hasDisabledAttr: btn.hasAttribute('disabled'),
          hasDisabledClass: btn.classList.contains('mat-button-disabled'),
          ariaDisabled: btn.getAttribute('aria-disabled'),
          btnDisabled: btn.disabled,
        };
      });
      console.log(`[Scraper] 🔘 Buton: ${JSON.stringify(btnState)}`);

      // Butona tıkla (aktif olana kadar bekle)
      let clicked = false;
      for (let retry = 0; retry < 20; retry++) {
        if (!btnState.found) {
          // Buton DOM'da yok - Recovery gerekli, ama önce uzun bekle
          await new Promise(r => setTimeout(r, 1000));
          const found = await page.evaluate(() => !!document.querySelector('.mat-paginator-navigation-next, [aria-label="Next page"], [aria-label="Sonraki sayfa"]'));
          if (!found && retry >= 5) {
            console.log(`[Scraper] 🚨 ${retry + 1}. denemede de buton yok! Recovery başlatılıyor...`);
            await navigateToPageByClicking(pageNum + 1, perPage);
            clicked = true; // navigateToPageByClicking hedef sayfaya gider
            break;
          }
          continue;
        }

        clicked = await page.evaluate(() => {
          const btn = document.querySelector('.mat-paginator-navigation-next, [aria-label="Next page"], [aria-label="Sonraki sayfa"]');
          if (!btn) return false;
          const dis = btn.hasAttribute('disabled') || btn.classList.contains('mat-button-disabled') || btn.getAttribute('aria-disabled') === 'true' || btn.disabled;
          if (!dis) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            return true;
          }
          if (retry % 4 === 0) {
            console.log(`Buton hâlâ disabled: disabled=${btn.hasAttribute('disabled')} class=${btn.classList.contains('mat-button-disabled')} aria=${btn.getAttribute('aria-disabled')}`);
          }
          return false;
        });

        if (clicked) {
          console.log(`[Scraper] ✅ Next butonuna tıklandı! (retry ${retry + 1})`);
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!clicked) {
        console.log(`[Scraper] ❌ 20 denemede tıklanamadı, döngü durduruluyor.`);
        break;
      }

      // Sayfa geçişini bekle (label veya ilk kart değişsin)
      const prevLabel = rangeLabel;
      const prevFirstCode = domItems[0]?.shortCode || '';
      try {
        await page.waitForFunction((pl, pc) => {
          const cur = document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '';
          const first = document.querySelector('a[href*="/detay/"]')?.href || '';
          const code = first.match(/\/detay\/([^/?&#]+)/)?.[1] || '';
          return (cur && cur !== pl && cur.includes('/')) || (code && code !== pc);
        }, { timeout: 20000, polling: 100 }, prevLabel, prevFirstCode);
        console.log(`[Scraper] 🔄 Geçiş algılandı.`);
      } catch (e) {
        console.log(`[Scraper] ⚠️ Geçiş timeout! Mevcut DOM:`, await page.evaluate(() => ({
          label: document.querySelector('.mat-paginator-range-label')?.innerText?.trim() || '',
          cards: document.querySelectorAll('a[href*="/detay/"]').length
        })));
      }

      // Angular stabilizasyonu için bekle
      await new Promise(r => setTimeout(r, 3000));
      pageNum++;
    }

    // Sonuçları birleştir: önce id ile eşleş, sonra normalize title ile
    const resultList = Array.from(allTendersMap.values()).map(tender => {
      const code = tender.shortCode || tender.id;
      const detailUrl = code ? `https://eihale.gov.tr/ihaleler/detay/${code}` : null;

      // 1. id ile eşleş (en güvenilir)
      let apiItem = apiTendersById.get(code);

      // 2. normalize title ile eşleş (çift boşluk normalize edilmiş)
      if (!apiItem) {
        const normalizedKey = (tender.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
        apiItem = apiTendersByTitle.get(normalizedKey);
      }

      if (apiItem) {
        return { ...apiItem, id: code, shortCode: code, detailUrl };
      }
      return { ...tender, detailUrl, shortCode: code };
    });

    console.log(`[Scraper] API verisiyle eşleşen: ${resultList.filter(r => r.modelYear !== undefined).length}/${resultList.length}`);

    console.log(`\n[Scraper] ✅ BİTTİ! TOPLAM TOPLANAN ARAÇ SAYISI: ${resultList.length}`);
    await browser.close();
    return resultList;

  } catch (error) {
    console.error('[Scraper] Hata:', error.message);
    await browser.close();
    return Array.from(allTendersMap.values());
  }
}
