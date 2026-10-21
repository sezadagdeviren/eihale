import React, { useState } from 'react';
import { 
  ClipboardCheck, 
  Copy, 
  MapPin, 
  Clock, 
  Car, 
  PlayCircle, 
  ExternalLink, 
  FileText, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle,
  Calendar,
  Gauge,
  Fuel,
  Cog,
  Wrench
} from 'lucide-react';

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function TenderCard({ tender, onOpenModal }) {
  const [copied, setCopied] = useState(false);

  const firstItem = tender.items?.[0] || {};
  const title = tender.title || firstItem.name || 'Araç İhalesi';
  const tenderNo = tender.tenderNumber || tender.tenderNo || '-';
  const priceVal = tender.price ?? tender.startingAmount ?? tender.itemStartingAmount ?? 0;
  const price = Number(priceVal).toLocaleString('tr-TR');
  const guaranteeVal = tender.guaranteeAmount ?? firstItem.guaranteeAmount ?? 0;
  const guarantee = Number(guaranteeVal).toLocaleString('tr-TR');

  const imageUrl = tender.thumbnail || 
                   firstItem.mediaList?.[0] || 
                   firstItem.itemMediaList?.[0]?.mediumPath || 
                   firstItem.itemMediaList?.[0]?.path;
  const videoUrl = firstItem.video;
  const isOfferable = tender.tenderStatus === 5;

  // Özellikleri toparla
  const attrMap = {
    'Yıl': tender.modelYear || '',
    'Km': tender.km || '',
    'Vites': tender.gear || '',
    'Yakıt': tender.fuel || '',
    'Motor Hacmi': tender.engineCC || '',
    'Tasfiye Nedeni': tender.disposalReason || '',
    'Ek Mali Yükümlülük': tender.extraObligation || '',
    ...(tender.attributes || {})
  };

  const findings = tender.expertiseResult?.findings || [];
  const hasExpertise = findings.length > 0;

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!tenderNo || tenderNo === '-') return;
    navigator.clipboard.writeText(tenderNo).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={`glass-panel modern-tender-card ${hasExpertise ? 'has-expertise-border' : ''}`}>
      {/* Görsel Kutusu */}
      <div className="card-image-box">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="card-image" loading="lazy" />
        ) : (
          <div className="image-placeholder">
            <Car size={48} />
          </div>
        )}
        
        <div className="card-badges-floating">
          {videoUrl && (
            <span className="badge-pill video-pill">
              <PlayCircle size={13} /> Video Var
            </span>
          )}
          <span className="badge-pill tender-no-pill" onClick={handleCopy} title="İhale No Kopyala">
            {copied ? <ClipboardCheck size={13} color="#10b981" /> : <Copy size={13} />} {tenderNo}
          </span>
        </div>

        {hasExpertise && (
          <div className="expertise-floating-tag">
            <ShieldAlert size={12} /> {findings.length} Ekspertiz Maddesi
          </div>
        )}
      </div>

      {/* Kart Gövdesi */}
      <div className="card-body">
        {/* Başlık ve Şehir */}
        <div className="meta-top-row">
          <span className="location-tag">
            <MapPin size={13} /> {tender.branchName || 'Bölge Belirtilmemiş'}
          </span>
          <span className={`status-pill ${isOfferable ? 'status-active' : 'status-pending'}`}>
            {isOfferable ? '● Teklif Verilebilir' : '○ İlan Edildi'}
          </span>
        </div>

        <h3 className="modern-card-title" title={title}>
          {title}
        </h3>

        {/* Tarihler ve Konum Bilgisi */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {tender.storeName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8' }}>
              <MapPin size={12} color="#38bdf8" />
              <span>Depo: <strong style={{ color: '#e2e8f0' }}>{tender.storeName}</strong></span>
            </div>
          )}
          {tender.startDate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8' }}>
              <Clock size={12} color="#10b981" />
              <span>Teklif Başlangıç: <strong style={{ color: '#e2e8f0' }}>{formatDate(tender.startDate)}</strong></span>
            </div>
          )}
          {tender.endDate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8' }}>
              <Clock size={12} color="#f59e0b" />
              <span>İhale Bitiş: <strong style={{ color: '#e2e8f0' }}>{formatDate(tender.endDate)}</strong></span>
            </div>
          )}
        </div>

        {/* Araç Teknik Parametreleri Grid */}
        <div className="modern-specs-grid">
          {attrMap['Yıl'] && (
            <div className="spec-chip">
              <span className="chip-label">Yıl</span>
              <span className="chip-val">{attrMap['Yıl']}</span>
            </div>
          )}
          {attrMap['Km'] && (
            <div className="spec-chip">
              <span className="chip-label">KM</span>
              <span className="chip-val">{attrMap['Km'].includes('km') ? attrMap['Km'] : `${attrMap['Km']} km`}</span>
            </div>
          )}
          {attrMap['Yakıt'] && (
            <div className="spec-chip">
              <span className="chip-label">Yakıt</span>
              <span className="chip-val">{attrMap['Yakıt']}</span>
            </div>
          )}
          {attrMap['Vites'] && (
            <div className="spec-chip">
              <span className="chip-label">Vites</span>
              <span className="chip-val">{attrMap['Vites']}</span>
            </div>
          )}
          {attrMap['Motor Hacmi'] && (
            <div className="spec-chip">
              <span className="chip-label">Motor</span>
              <span className="chip-val">{attrMap['Motor Hacmi']} cc</span>
            </div>
          )}
          {attrMap['Tasfiye Nedeni'] && (
            <div className="spec-chip">
              <span className="chip-label">Tasfiye</span>
              <span className="chip-val">{attrMap['Tasfiye Nedeni']}</span>
            </div>
          )}
        </div>

        {/* Ek Mali Yükümlülük Bildirimi */}
        {attrMap['Ek Mali Yükümlülük'] && (
          <div style={{
            background: 'rgba(234, 179, 8, 0.08)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 12,
            fontSize: 11,
            lineHeight: 1.45,
            color: '#fef08a'
          }}>
            <strong style={{ color: '#facc15', display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              📌 Ek Mali Yükümlülük:
            </strong>
            {attrMap['Ek Mali Yükümlülük']}
          </div>
        )}

        {/* Ekspertiz Raporu Bölümü — Tüm Tespitler */}
        {hasExpertise ? (
          <div className="expertise-card-section">
            <div className="expertise-section-header">
              <div className="header-left">
                <Wrench size={15} color="#ef4444" />
                <span className="section-title">Ekspertiz Sonucu</span>
                <span className="findings-counter">{findings.length} Tespit</span>
              </div>
            </div>

            <div className="findings-container expanded">
              <ul className="findings-list">
                {findings.map((item, idx) => (
                  <li key={idx} className="finding-item">
                    <span className="finding-bullet">•</span>
                    <span className="finding-text">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="no-expertise-box">
            <AlertTriangle size={14} /> Ekspertiz belgesi sisteme henüz yüklenmemiş
          </div>
        )}

        {/* Fiyat, Satışa Esas Bedel ve Teminat Kutusu */}
        <div className="modern-price-box" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="price-sub">Başlangıç Bedeli</span>
              <span className="price-amount">{price} ₺</span>
            </div>
            {tender.realPrice && (
              <div style={{ textAlign: 'right' }}>
                <span className="price-sub">Satışa Esas Bedel</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#38bdf8' }}>
                  {Number(tender.realPrice).toLocaleString('tr-TR')} ₺
                </span>
              </div>
            )}
          </div>

          {(tender.priceGuarantee || guaranteeVal > 0) && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 6,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>🔒 Teminat Bedeli</span>
              <span className="guarantee-amount">
                {Number(tender.priceGuarantee || guaranteeVal).toLocaleString('tr-TR')} ₺
              </span>
            </div>
          )}
        </div>

        {/* Aksiyon Butonları */}
        <div className="card-footer-actions">
          <a 
            href={tender.detailUrl || `https://eihale.gov.tr/?categoryId=cd02a1a7-4c0a-02dd-28e7-39f737373d83`}
            target="_blank" 
            rel="noopener noreferrer" 
            className="btn btn-primary action-btn-link"
          >
            İhaleye Git <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
