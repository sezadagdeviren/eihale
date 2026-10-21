import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { scrapeVehicles } from './scraper.js';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const { Client, LocalAuth, MessageMedia } = pkg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'tenders.json');

app.use(cors());
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'images')));

// ─── WhatsApp Client ────────────────────────────────────────────────────────
let waClient = null;
let waReady = false;
let waQR = null;
let waStatus = 'disconnected'; // disconnected | qr | connecting | ready

function initWhatsApp() {
  console.log('[WhatsApp] Client başlatılıyor...');
  waStatus = 'connecting';

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018944888-alpha.html',
    },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  waClient.on('qr', async (qr) => {
    waStatus = 'qr';
    console.log('\n[WhatsApp] QR Kodu terminalde tarayın:');
    qrcode.generate(qr, { small: true });
    try {
      const QRCodeLib = (await import('qrcode')).default;
      waQR = await QRCodeLib.toDataURL(qr);
    } catch (e) {
      waQR = qr;
    }
  });

  waClient.on('ready', () => {
    waReady = true;
    waQR = null;
    waStatus = 'ready';
    console.log('[WhatsApp] ✅ Bağlantı hazır! Bildirimler aktif.');
  });

  waClient.on('disconnected', (reason) => {
    waReady = false;
    waStatus = 'disconnected';
    console.log('[WhatsApp] Bağlantı kesildi:', reason);
    // 10 saniye sonra yeniden bağlan
    setTimeout(initWhatsApp, 10000);
  });

  waClient.on('auth_failure', () => {
    waReady = false;
    waStatus = 'disconnected';
    console.error('[WhatsApp] Kimlik doğrulama başarısız. Oturum temizleniyor...');
  });

  waClient.initialize();
}

// ─── WhatsApp Bildirim Fonksiyonu ────────────────────────────────────────────
async function sendWhatsAppNotification(tender) {
  let whatsappTarget = process.env.WHATSAPP_TARGET;
  if (!waReady || !whatsappTarget) return;

  // Numara formatını otomatik düzelt: 05xx → 905xx, boşlukları temizle
  const rawNum = whatsappTarget.trim().replace('@c.us', '').trim();
  const fixedNum = rawNum.startsWith('0') ? '9' + rawNum : rawNum;
  whatsappTarget = fixedNum + '@c.us';

  const firstItem = tender.items?.[0] || {};
  const title = tender.title || firstItem.name || tender.tenderTitle || 'Yeni Araç İhalesi';
  const priceVal = tender.price ?? tender.startingAmount ?? tender.itemStartingAmount ?? 0;
  const price = Number(priceVal).toLocaleString('tr-TR') + ' ₺';
  const branch = tender.branchName || 'Bilinmiyor';
  const tenderNo = tender.tenderNumber || tender.tenderNo || '-';
  const detailUrl = tender.detailUrl || `https://eihale.gov.tr/?categoryId=cd02a1a7-4c0a-02dd-28e7-39f737373d83`;
  const photoUrl = firstItem.medias?.[0]?.mediumPath || firstItem.medias?.[0]?.path || tender.thumbnail;

  // İlan Durumu etiketi
  const statusMap = {
    1: '📢 İlan Edildi',
    2: '⏳ Teklif Toplama',
    3: '📌 İLAN YAYINDA',
    4: '✅ SONUÇLANDI',
    5: '🔥 TEKLİF VERİLEBİLİR',
    6: '❌ İPTAL EDİLDİ'
  };
  const statusLabel = statusMap[tender.tenderStatus] || `DURUM: ${tender.tenderStatus}`;

  // Özellik haritası
  const attrMap = {
    'Yıl': tender.modelYear || '',
    'Km': tender.km || '',
    'Yakıt': tender.fuel || '',
    'Vites': tender.gear || '',
    'Motor Hacmi': tender.engineCC || '',
    'Tasfiye Nedeni': tender.disposalReason || '',
    'Ek Mali Yükümlülük': tender.extraObligation || '',
    ...(tender.attributes || {})
  };
  (firstItem.attributes || []).forEach(a => {
    if (a.key && a.value && !attrMap[a.key]) attrMap[a.key] = String(a.value).trim();
  });

  let specs = [];
  if (attrMap['Yıl']) specs.push(`  📅 *Model Yılı:* ${attrMap['Yıl']}`);
  if (attrMap['Km']) specs.push(`  🛣 *Kilometre:* ${attrMap['Km'].includes('km') ? attrMap['Km'] : attrMap['Km'] + ' km'}`);
  if (attrMap['Yakıt']) specs.push(`  ⛽ *Yakıt Türü:* ${attrMap['Yakıt']}`);
  if (attrMap['Vites']) specs.push(`  🕹 *Vites:* ${attrMap['Vites']}`);
  if (attrMap['Motor Hacmi']) specs.push(`  ⚙️ *Motor Hacmi:* ${attrMap['Motor Hacmi']} cc`);
  if (attrMap['Tasfiye Nedeni']) specs.push(`  ⚖️ *Tasfiye:* ${attrMap['Tasfiye Nedeni']}`);
  if (attrMap['Ek Mali Yükümlülük']) specs.push(`  📌 *Ek Yükümlülük:* ${attrMap['Ek Mali Yükümlülük']}`);

  // Bedeller & Teminat
  const realPriceStr = tender.realPrice ? Number(tender.realPrice).toLocaleString('tr-TR') + ' ₺' : null;
  const guaranteeStr = tender.priceGuarantee ? Number(tender.priceGuarantee).toLocaleString('tr-TR') + ' ₺' : null;
  const storeStr = tender.storeName || null;
  const extraObligation = attrMap['Ek Mali Yükümlülük'] || null;

  // Tarih biçimlendirme
  const fmtDate = (d) => {
    if (!d) return null;
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return d; }
  };
  const startDateStr = fmtDate(tender.startDate);
  const endDateStr = fmtDate(tender.endDate);

  // Şık & Düzenli WhatsApp Kart Tasarımı
  let message = `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🚘 *${title.toUpperCase()}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🏷 *İlan Durumu:*  ${statusLabel}\n` +
    `🔢 *İhale No:*  \`${tenderNo}\`\n` +
    `🏢 *İşletme Md.:*  ${branch}\n`;

  if (storeStr) {
    message += `📍 *Bulunduğu Yer:*  ${storeStr}\n`;
  }

  // Fiyatlar
  message += `\n💰 *FİYAT BİLGİLERİ*\n` +
    `  • *Başlangıç Bedeli:*  ${price}\n`;
  if (realPriceStr) {
    message += `  • *Satışa Esas Bedel:*  ${realPriceStr}\n`;
  }
  if (guaranteeStr) {
    message += `  • *Teminat Bedeli:*  *${guaranteeStr}*\n`;
  }

  // Tarihler
  if (startDateStr || endDateStr) {
    message += `\n⏰ *İHALE TARİHLERİ*\n`;
    if (startDateStr) message += `  • *Teklif Başlangıç:*  ${startDateStr}\n`;
    if (endDateStr) message += `  • *İhale Bitiş:*  *${endDateStr}*\n`;
  }

  // Araç Özellikleri
  if (specs.length > 0) {
    message += `\n📋 *ARAÇ ÖZELLİKLERİ*\n` + specs.join('\n') + `\n`;
  }

  // Ek Mali Yükümlülük (Özel Vurgu)
  if (extraObligation) {
    const shortObligation = extraObligation.length > 180 ? extraObligation.substring(0, 177) + '...' : extraObligation;
    message += `\n⚠️ *EK MALİ YÜKÜMLÜLÜK*\n_${shortObligation}_\n`;
  }

  // Ekspertiz Özeti (En önemli tespitler)
  if (tender.expertiseResult?.findings?.length > 0) {
    const findings = tender.expertiseResult.findings;
    message += `\n🔍 *EKSPERTİZ RAPORU (${findings.length} Madde)*\n`;
    const topFindings = findings.slice(0, 6);
    topFindings.forEach(f => { message += `  • ${f}\n`; });
    if (findings.length > 6) {
      message += `  _...ve ${findings.length - 6} tespit daha_\n`;
    }
  }

  message += `\n🌐 *Detay ve Teklif Ver:*\n${detailUrl}\n` +
             `━━━━━━━━━━━━━━━━━━━━━━`;

  const safeCaption = message.length > 1020 ? message.substring(0, 1017) + '...' : message;

  try {
    let sentMsg = null;
    // 1. Yerel diskte fotoğraf varsa doğrudan tek mesaj (Fotoğraf + Kart Açıklaması) olarak gönder
    if (localImagePath && fs.existsSync(localImagePath) && fs.statSync(localImagePath).size > 500) {
      try {
        console.log(`[WhatsApp Görsel] Yerel diskten yükleniyor: ${localImagePath}`);
        const media = MessageMedia.fromFilePath(localImagePath);
        sentMsg = await waClient.sendMessage(whatsappTarget, media, { caption: safeCaption });
        console.log(`[WhatsApp] 📸 Fotoğraflı kart tek mesaj olarak gönderildi: ${title}`);
      } catch (localErr) {
        console.warn(`[WhatsApp Görsel] Yerel dosya hatası:`, localErr.message);
      }
    }

    // 2. Yerelde yoksa CDN'den dene
    if (!sentMsg && photoUrl) {
      try {
        const largeUrl = photoUrl.replace('/image/small/', '/image/large/').replace('/image/medium/', '/image/large/');
        let imgRes = await fetch(largeUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
          signal: AbortSignal.timeout(10000)
        }).catch(() => null);

        if (!imgRes || !imgRes.ok) {
          imgRes = await fetch(photoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
            signal: AbortSignal.timeout(10000)
          });
        }

        if (imgRes && imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          if (buffer.length > 500) {
            const base64 = buffer.toString('base64');
            const media = new MessageMedia('image/jpeg', base64, 'arac.jpg');
            sentMsg = await waClient.sendMessage(whatsappTarget, media, { caption: safeCaption });
            console.log(`[WhatsApp] 📸 Fotoğraflı kart tek mesaj olarak gönderildi: ${title}`);
          }
        }
      } catch (cdnErr) {
        console.warn(`[WhatsApp CDN Görsel Hatası]:`, cdnErr.message);
      }
    }

    // 3. Görsel yoksa veya bulunamazsa sadece metin kartı olarak gönder
    if (!sentMsg) {
      sentMsg = await waClient.sendMessage(whatsappTarget, message);
      console.log(`[WhatsApp] 📄 Metin kartı olarak gönderildi: ${title}`);
    }

    // Mesaj ID'sini kaydet
    if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
      tender.whatsappMessageId = sentMsg.id._serialized;
      tender.whatsappSentAt = new Date().toISOString();
      tender.whatsappLastStatus = 'OPEN';
      fs.writeFileSync(DATA_FILE, JSON.stringify(cachedTenders, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`[WhatsApp] Hata (${whatsappTarget}):`, err?.message?.split('\n')[0] || String(err));
  }
}

// ─── Süresi Biten İlanları WhatsApp'ta Düzenleme (Edit) ─────────────────────────
async function updateExpiredWhatsAppMessages() {
  if (!waReady || !process.env.WHATSAPP_TARGET) return;
  const now = new Date();

  for (const t of cachedTenders) {
    // Sadece WhatsApp'a gönderilmiş, bitiş tarihi geçmiş ve henüz KAPANDI olarak düzenlenmemiş olanlar
    if (t.whatsappMessageId && t.whatsappLastStatus !== 'CLOSED' && t.endDate) {
      const endDt = new Date(t.endDate);
      if (now >= endDt) {
        try {
          console.log(`[WhatsApp Edit] Süresi dolan ilan güncelleniyor: ${t.title}`);
          const msg = await waClient.getMessageById(t.whatsappMessageId);
          if (msg) {
            const currentBody = msg.caption || msg.body || '';
            const updatedBody = currentBody
              .replace(/🏷 \*İlan Durumu:\*.*?\n/, '🔴 *DURUM:*  *İHALENİN SÜRESİ DOLDU (KAPANDI) (Düzenlendi)*\n')
              .replace(/🔥 TEKLİF VERİLEBİLİR/, '🔴 İHALE KAPANDI')
              .replace(/📌 İLAN YAYINDA/, '🔴 İHALE KAPANDI');

            await msg.edit(updatedBody);
            t.whatsappLastStatus = 'CLOSED';
            t.whatsappClosedAt = now.toISOString();
            console.log(`[WhatsApp Edit] ✅ Başarıyla düzenlendi: ${t.title}`);
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (editErr) {
          console.warn(`[WhatsApp Edit Hatası] ${t.title}:`, editErr.message);
        }
      }
    }
  }
}

// ─── Bellekte ve dosyada saklanan ihale listesi ──────────────────────────────
let cachedTenders = [];
let lastScrapeTime = null;
let isScraping = false;

// Dosyadan yükle
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    cachedTenders = JSON.parse(raw);
    console.log(`[Server] Önceden kaydedilmiş ${cachedTenders.length} adet ihale yüklendi.`);
  } catch (e) {
    console.error('[Server] Veri dosyası okunamadı:', e.message);
  }
}

// ─── Veri Çekme Fonksiyonu ───────────────────────────────────────────────────
async function runScrapeJob() {
  if (isScraping) return;
  isScraping = true;
  console.log('[Server] İhale tarama görevi başladı...');

  try {
    const freshTenders = await scrapeVehicles();
    lastScrapeTime = new Date().toISOString();

    if (freshTenders && freshTenders.length > 0) {
      // 1. Yeni gelenleri tespit et
      const existingMap = new Map(cachedTenders.map(t => [t.id, t]));
      const newlyAdded = freshTenders.filter(t => !existingMap.has(t.id));

      // 2. Akıllı Birleştirme: Var olan ilan aynıysa üzerine yazma, sadece eksik alanlarını doldur!
      const mergedList = [];
      const freshMap = new Map(freshTenders.map(t => [t.id, t]));

      // Önce mevcutları işle
      for (const oldTender of cachedTenders) {
        const fresh = freshMap.get(oldTender.id);
        if (fresh) {
          // Var olan ilan: Eğer eski ilanın verisi eksikse tazesinden doldur
          const merged = {
            ...oldTender,
            price: (fresh.price && fresh.price > 0) ? fresh.price : oldTender.price,
            thumbnail: fresh.thumbnail || oldTender.thumbnail,
            branchName: fresh.branchName || oldTender.branchName,
            tenderNumber: fresh.tenderNumber || oldTender.tenderNumber,
            tenderStatus: fresh.tenderStatus ?? oldTender.tenderStatus,
            modelYear: fresh.modelYear || oldTender.modelYear,
            km: fresh.km || oldTender.km,
            gear: fresh.gear || oldTender.gear,
            engineCC: fresh.engineCC || oldTender.engineCC,
            fuel: fresh.fuel || oldTender.fuel,
            color: fresh.color || oldTender.color,
            brand: fresh.brand || oldTender.brand,
            model: fresh.model || oldTender.model,
            plate: fresh.plate || oldTender.plate,
            disposalReason: fresh.disposalReason || oldTender.disposalReason,
            extraObligation: fresh.extraObligation || oldTender.extraObligation,
            attributes: fresh.attributes || oldTender.attributes,
            publishedDate: fresh.publishedDate || oldTender.publishedDate,
            endDate: fresh.endDate || oldTender.endDate
          };
          mergedList.push(merged);
        } else {
          mergedList.push(oldTender);
        }
      }

      // Yeni gelenleri de listeye ekle
      for (const fresh of newlyAdded) {
        mergedList.push(fresh);
      }

      // Sadece gerçek araç ilanlarını listeye dahil et (eski denemelerden kalan eldiven/saat gibi boş kayıtları temizle)
      const validVehicleList = mergedList.filter(t => 
        t.modelYear || t.km || t.engineCC || t.fuel || (t.price > 0 && t.tenderNumber)
      );

      // HEMEN FRONTEND VE VERİTABANI İÇİN AKTİF ET
      cachedTenders = validVehicleList;
      fs.writeFileSync(DATA_FILE, JSON.stringify(cachedTenders, null, 2), 'utf-8');
      console.log(`[Server] ⚡ Veriler HEMEN güncellendi! Toplam ${cachedTenders.length} gerçek araç ilanı frontend'e hazır.`);

      // 3. WhatsApp bildirimlerini arka planda (frontend'i ve scraper bitişini bloklamadan) gönder
      if (newlyAdded.length > 0) {
        console.log(`[Server] ${newlyAdded.length} ADET YENİ ARAÇ İHALESİ TESPİT EDİLDİ! (Arka planda gönderiliyor)`);
        (async () => {
          for (const t of newlyAdded) {
            await sendWhatsAppNotification(t);
            await new Promise(r => setTimeout(r, 600)); // Rate limit
          }
        })().catch(err => console.error('[WhatsApp Gönderim Hatası]:', err.message));
      }
    }
  } catch (error) {
    console.error('[Server] Tarama hatası:', error.message);
  } finally {
    isScraping = false;
  }
}

// ─── REST API Endpoints ──────────────────────────────────────────────────────
app.get('/api/tenders', (req, res) => {
  res.json({
    success: true,
    count: cachedTenders.length,
    lastScrapeTime,
    isScraping,
    data: cachedTenders
  });
});

app.post('/api/refresh', async (req, res) => {
  if (isScraping) {
    return res.status(429).json({ success: false, message: 'Tarama zaten devam ediyor.' });
  }
  runScrapeJob();
  res.json({ success: true, message: 'Tarama işlemi tetiklendi.' });
});

// WhatsApp durum endpoint'i
app.get('/api/whatsapp/status', (req, res) => {
  const rawTarget = process.env.WHATSAPP_TARGET || '';
  const rawNum = rawTarget.trim().replace('@c.us', '').trim();
  const fixedNum = rawNum.startsWith('0') ? '9' + rawNum : rawNum;
  const target = fixedNum ? fixedNum + '@c.us' : '(ayarlanmamış)';

  res.json({
    success: true,
    status: waStatus,
    ready: waReady,
    target,
    qr: waQR
  });
});

// WhatsApp test mesajı gönder (debug)
app.post('/api/whatsapp/test-message', async (req, res) => {
  const rawTarget = process.env.WHATSAPP_TARGET || '';
  const rawNum = rawTarget.trim().replace('@c.us', '').trim();
  const fixedNum = rawNum.startsWith('0') ? '9' + rawNum : rawNum;
  const target = fixedNum + '@c.us';

  console.log('[WhatsApp Test] Durum:', waStatus, '| Hazır:', waReady, '| Hedef:', target);

  if (!waReady) {
    return res.status(400).json({ success: false, message: `WhatsApp hazır değil. Durum: ${waStatus}` });
  }
  if (!fixedNum) {
    return res.status(400).json({ success: false, message: 'WHATSAPP_TARGET .env dosyasında tanımlı değil.' });
  }

  try {
    console.log('[WhatsApp Test] Mesaj gönderiliyor →', target);
    await waClient.sendMessage(target, '🧪 *e-İhale Bot Test Mesajı*\nBağlantı başarıyla çalışıyor! ✅');
    console.log('[WhatsApp Test] ✅ Başarıyla gönderildi!');
    res.json({ success: true, message: `Test mesajı ${target} adresine gönderildi.` });
  } catch (err) {
    const errMsg = err?.message?.split('\n')[0] || String(err);
    console.error('[WhatsApp Test] ❌ Hata:', errMsg);
    res.status(500).json({ success: false, message: errMsg });
  }
});



// WhatsApp hedef numarası kaydet
app.post('/api/whatsapp/settings', async (req, res) => {
  const { target } = req.body; // örn: "905551234567"
  if (!target) {
    return res.status(400).json({ success: false, message: 'Hedef numara zorunludur.' });
  }

  // Formatla: 905551234567 → 905551234567@c.us
  const formatted = target.replace(/\D/g, '') + '@c.us';
  process.env.WHATSAPP_TARGET = formatted;

  // .env dosyasına yaz
  let envContent = '';
  try { envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8'); } catch { }
  if (envContent.includes('WHATSAPP_TARGET=')) {
    envContent = envContent.replace(/WHATSAPP_TARGET=.*/g, `WHATSAPP_TARGET=${formatted}`);
  } else {
    envContent += `\nWHATSAPP_TARGET=${formatted}`;
  }
  fs.writeFileSync(path.join(__dirname, '.env'), envContent.trim() + '\n', 'utf-8');

  // Test mesajı gönder
  if (waReady) {
    try {
      await waClient.sendMessage(formatted, '✅ *e-İhale Bot Bağlantısı Başarılı!*\nAraç ihaleleri takip ediliyor...');
      return res.json({ success: true, message: 'Bağlantı başarılı! WhatsApp\'a test mesajı gönderildi.' });
    } catch (e) {
      console.error('[WhatsApp Gönderim Hatası]:', e.message);
      if (e.message.includes('detached Frame') || e.message.includes('Execution context was destroyed')) {
        waReady = false;
        waStatus = 'connecting';
        try { await waClient.destroy(); } catch {}
        setTimeout(initWhatsApp, 2000);
        return res.status(500).json({ 
          success: false, 
          message: 'WhatsApp Web tarayıcı oturumu arka planda tazelendi. Lütfen 5-10 saniye sonra tekrar deneyin.' 
        });
      }
      return res.status(500).json({ success: false, message: 'Mesaj gönderilemedi: ' + e.message });
    }
  }

  res.json({ success: true, message: 'Numara kaydedildi. WhatsApp bağlantısı kurulduğunda test mesajı gönderilecek.' });
});

// Tüm ilanları WhatsApp'a gönder
let isSendingAll = false;
app.post('/api/notify-all', async (req, res) => {
  if (!waReady || !process.env.WHATSAPP_TARGET) {
    return res.status(400).json({ success: false, message: 'WhatsApp bağlı değil. Önce QR kodu tarayın.' });
  }
  if (isSendingAll) {
    return res.status(429).json({ success: false, message: 'Gönderim zaten devam ediyor...' });
  }

  // Status 3 (İlan Yayında) + Status 5 (Teklif Verilebilir) gönder
  // ?status=3 veya ?status=5 ile sadece o statüdekiler de gönderilebilir
  const statusFilter = req.query.status ? Number(req.query.status) : null;
  const toSend = statusFilter !== null
    ? cachedTenders.filter(t => t.tenderStatus === statusFilter)
    : cachedTenders.filter(t => t.tenderStatus === 3 || t.tenderStatus === 5);

  if (toSend.length === 0) {
    return res.status(400).json({ success: false, message: 'Gönderilecek ilan bulunamadı.' });
  }

  res.json({
    success: true,
    message: `${toSend.length} ilan WhatsApp'a gönderilmeye başlandı. Bu işlem birkaç dakika sürebilir.`,
    count: toSend.length
  });

  isSendingAll = true;
  (async () => {
    let sent = 0, failed = 0;
    console.log(`[WhatsApp] ${toSend.length} ilan gönderimi başladı...`);
    for (const tender of toSend) {
      try {
        await sendWhatsAppNotification(tender);
        sent++;
      } catch (e) {
        failed++;
      }
      await new Promise(r => setTimeout(r, 800)); // WhatsApp rate limit
    }
    console.log(`[WhatsApp] Toplu gönderim tamamlandı. Gönderilen: ${sent}, Hata: ${failed}`);
    isSendingAll = false;
  })();
});

// ─── Başlatma ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] Backend API http://localhost:${PORT} üzerinde çalışıyor.`);

  // WhatsApp'ı başlat
  initWhatsApp();

  // İlk çalıştırmada arka planda tara
  if (cachedTenders.length === 0) {
    setTimeout(runScrapeJob, 5000); // 5 sn bekleyip tara
  }

  // Her 10 dakikada bir otomatik tara
  setInterval(runScrapeJob, 10 * 60 * 1000);

  // Her 2 dakikada bir süresi biten ilanları WhatsApp üzerinde otomatik güncelle (Edit)
  setInterval(updateExpiredWhatsAppMessages, 2 * 60 * 1000);
});
