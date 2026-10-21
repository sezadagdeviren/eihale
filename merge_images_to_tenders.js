import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tendersPath = path.join(__dirname, 'tenders.json');
const imagesDir = path.join(__dirname, 'images');

const raw = fs.readFileSync(tendersPath, 'utf8');
const data = JSON.parse(raw);
const tenders = Array.isArray(data) ? data : (data.tenders || []);

let matched = 0;
tenders.forEach(t => {
  const localFileName = (t.id || '') + '.jpg';
  const localFilePath = path.join(imagesDir, localFileName);
  
  if (t.id && fs.existsSync(localFilePath)) {
    t.localImage = `images/${localFileName}`;
    t.localImagePath = localFilePath;
    matched++;
  }

  const firstItem = t.items?.[0] || {};
  let currentUrl = firstItem.medias?.[0]?.mediumPath || firstItem.medias?.[0]?.path || t.thumbnail;
  if (currentUrl) {
    const largeUrl = currentUrl.replace('/image/small/', '/image/large/').replace('/image/medium/', '/image/large/');
    t.largeThumbnail = largeUrl;
  }
});

fs.writeFileSync(tendersPath, JSON.stringify(tenders, null, 2), 'utf8');
console.log(`✅ ${matched} / ${tenders.length} ilana yerel görsel yolu (localImage, localImagePath) ve largeThumbnail başarıyla birleştirildi.`);
