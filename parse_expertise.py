import os
import json
import re
from PIL import Image
import pytesseract

def parse_expertise_text(text):
    """
    OCR metnini yapılandırılmış JSON nesnesine dönüştürür.
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    
    findings = []
    chassis_no = None
    report_date = None
    company_name = None
    
    # Tarih regex (örn: 03.07.2026 veya 03/07/2026)
    date_match = re.search(r'Tarih\s*:\s*(\d{2}[\./]\d{2}[\./]\d{4})', text, re.IGNORECASE)
    if date_match:
        report_date = date_match.group(1)
        
    # Şasi numarası regex
    chassis_match = re.search(r'([A-Z0-9]{11,17})\s+şasi', text, re.IGNORECASE)
    if chassis_match:
        chassis_no = chassis_match.group(1)

    # Tespit edilen maddeleri ayıkla
    is_findings_section = False
    
    # Başlık tetikleyicileri
    header_keywords = [
        'EKSPERTİZ SONUCU', 'DURUM DEĞERLENDİRMESİ', 'TESPİT EDİLMİŞTİR', 
        'TESPİTLER', 'ARAÇ DURUMU', 'DEĞERLENDİRME'
    ]
    
    # Durum/Arıza belirten kelimeler
    defect_keywords = [
        'bulunuyor', 'bulunmaktadır', 'yoktur', 'var', 'vardır', 'hasarlı', 'hasarlıdır',
        'arızalı', 'arızalıdır', 'aşınmış', 'çürük', 'çürükler', 'çalıştırılamamıştır', 
        'çalıştırıldı', 'yıpranmış', 'çatlak', 'kırık', 'kırıktır', 'vaziyette', 'patlak', 
        'patlaktır', 'ezik', 'çizik', 'eksik', 'eksiktir', 'mevcut', 'değildir'
    ]

    for line in lines:
        line_upper = line.upper()
        if any(hk in line_upper for hk in header_keywords):
            is_findings_section = True
            continue
            
        if is_findings_section:
            # Genel bilgilendirme / dipnot satırlarını ele
            if 'KONTROLLER GÖRSEL' in line_upper or 'TESPİT EDİLEMEDİĞİ' in line_upper or 'ŞASE NUMARALI' in line_upper or 'MARKA' in line_upper:
                continue

            # İnceleme maddeleri
            line_lower = line.lower()
            if any(kw in line_lower for kw in defect_keywords):
                clean_item = re.sub(r'^[-\*\•\d\.\)]\s*', '', line).strip()
                if clean_item and len(clean_item) > 4 and clean_item not in findings:
                    findings.append(clean_item)

    return {
        "reportDate": report_date or "",
        "chassisNo": chassis_no or "",
        "findings": findings,
        "rawSummary": " | ".join(findings[:6]) if findings else "",
        "itemCount": len(findings)
    }

def process_expertise_for_tender(image_path, short_code, tenders_json_path='tenders.json'):
    """
    Belirtilen görseli okur, OCR yapar ve tenders.json içindeki ilgili ilana ekler.
    """
    if not os.path.exists(image_path):
        print(f"Hata: {image_path} bulunamadı.")
        return False

    print(f"[{short_code}] OCR başlatılıyor: {image_path}")
    try:
        # Doğrudan dosya yolunu ver (MPO, JPEG, PNG vs. format uyumsuzluklarını önler)
        ocr_text = pytesseract.image_to_string(image_path, lang='tur+eng')
    except Exception:
        try:
            # Fallback: Pillow ile RGB dönüştürerek oku
            with Image.open(image_path) as img:
                rgb_img = img.convert('RGB')
                ocr_text = pytesseract.image_to_string(rgb_img, lang='tur+eng')
        except Exception as ocr_err:
            print(f"[{short_code}] OCR hatası: {ocr_err}")
            return False
    
    result = parse_expertise_text(ocr_text)
    print(f"[{short_code}] OCR Tamamlandı. {result['itemCount']} adet tespit bulundu.")

    if not os.path.exists(tenders_json_path):
        print(f"Hata: {tenders_json_path} bulunamadı.")
        return False

    with open(tenders_json_path, 'r', encoding='utf-8') as f:
        tenders = json.load(f)

    updated = False
    for t in tenders:
        if (t.get('shortCode') == short_code or 
            t.get('id') == short_code or 
            t.get('tenderNumber') == short_code or
            (short_code and t.get('title') and short_code.lower() in t.get('title').lower())):
            t['expertiseResult'] = result
            t['expertiseImageUrl'] = image_path
            updated = True
            print(f"[{short_code}] tenders.json başarıyla güncellendi!")
            break

    if updated:
        with open(tenders_json_path, 'w', encoding='utf-8') as f:
            json.dump(tenders, f, ensure_ascii=False, indent=2)
        return result
    else:
        print(f"[{short_code}] tenders.json içinde ilan bulunamadı.")
        return False

if __name__ == '__main__':
    # Test: Tofaş Kartal (ffTkmYsrmc9epVByZ37g9o) için sadece 2. ekspertiz sonucunu işle
    target_img = 'expertise_reports/tofas_kartal_sonuc_2.jpg'
    target_code = 'ffTkmYsrmc9epVByZ37g9o'
    res = process_expertise_for_tender(target_img, target_code)
    print("\nÜretilen JSON:")
    print(json.dumps(res, ensure_ascii=False, indent=2))
