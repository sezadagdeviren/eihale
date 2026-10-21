import React, { useState, useEffect } from 'react';
import { 
  Car, 
  Search, 
  RefreshCw, 
  Send, 
  ExternalLink, 
  MapPin, 
  FileText, 
  Sparkles,
  Bell,
  Clock,
  PlayCircle,
  Calendar,
  Gauge,
  Fuel,
  Cog,
  CheckCircle2,
  AlertCircle,
  Copy,
  ClipboardCheck,
  MessageSquare,
  MessageCircle
} from 'lucide-react';


// İlan no kopyalama butonu
function CopyTenderNoBtn({ tenderNo }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!tenderNo) return;
    navigator.clipboard.writeText(tenderNo).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className={`btn ${copied ? 'btn-primary' : 'btn-secondary'}`}
      style={{ 
        padding: '8px 12px', 
        fontSize: '12px', 
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        whiteSpace: 'nowrap'
      }}
      title={`İlan No: ${tenderNo} — kopyalamak için tıklayın`}
    >
      {copied ? (
        <><ClipboardCheck size={14} /> Kopyalandı</>
      ) : (
        <><Copy size={14} /> No</>
      )}
    </button>
  );
}

import TenderCard from './components/TenderCard';

export default function App() {
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL'); // ALL, 5 (Teklif Verilebilir), 3 (İlan Edildi)
  const [filterExpertiseOnly, setFilterExpertiseOnly] = useState(false); // Ekspertiz sonucu olanları filtrele
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [waStatus, setWaStatus] = useState('disconnected');
  const [waReady, setWaReady] = useState(false);
  const [waQR, setWaQR] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Verileri çek
  const fetchTenders = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/tenders');
      const json = await res.json();
      if (json.success) {
        setTenders(json.data || []);
      }
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchWhatsAppStatus = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/whatsapp/status');
      const json = await res.json();
      if (json.success) {
        setWaStatus(json.status);
        setWaReady(json.ready);
        setWaQR(json.qr);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchTenders();
    fetchWhatsAppStatus();
    const interval = setInterval(() => {
      fetchTenders();
      fetchWhatsAppStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('http://localhost:3001/api/refresh', { method: 'POST' });
      setTimeout(async () => {
        await fetchTenders();
        setRefreshing(false);
      }, 8000);
    } catch (e) {
      setRefreshing(false);
    }
  };

  const handleSaveWhatsApp = async (e) => {
    e.preventDefault();
    setStatusMessage('Test mesajı gönderiliyor...');
    try {
      const res = await fetch('http://localhost:3001/api/whatsapp/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: whatsappNumber })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage('✅ ' + data.message);
      } else {
        setStatusMessage('❌ ' + data.message);
      }
    } catch (e) {
      setStatusMessage('❌ Hata oluştu: ' + e.message);
    }
  };

  const [sendingWA, setSendingWA] = useState(false);
  const handleSendToWhatsApp = async (statusParam = null) => {
    let confirmMsg = 'İlanlar WhatsApp numaranıza gönderilsin mi?';
    if (statusParam === 5) {
      confirmMsg = 'Teklif verilebilir ilanlar WhatsApp numaranıza gönderilsin mi?';
    } else if (statusParam === null) {
      confirmMsg = 'Yayındaki ve teklif verilebilir tüm ilanlar (Status 3 ve 5) WhatsApp numaranıza gönderilsin mi?';
    } else {
      confirmMsg = `Seçili ilanlar WhatsApp numaranıza gönderilsin mi?`;
    }

    if (!window.confirm(confirmMsg)) {
      return;
    }
    setSendingWA(true);
    try {
      const url = statusParam !== null 
        ? `http://localhost:3001/api/notify-all?status=${statusParam}` 
        : 'http://localhost:3001/api/notify-all';
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      alert(data.message || 'Gönderim başlatıldı.');
    } catch (err) {
      alert('Hata oluştu: ' + err.message);
    } finally {
      setSendingWA(false);
    }
  };

  // Şubeler ve Durum Sayıları
  const branches = ['ALL', ...new Set(tenders.map(t => t.branchName).filter(Boolean))];
  const countTeklif = tenders.filter(t => t.tenderStatus === 5).length;
  const countIlan = tenders.filter(t => t.tenderStatus === 3).length;
  const countWithExpertise = tenders.filter(t => t.expertiseResult?.findings?.length > 0).length;

  const filteredTenders = tenders
    .filter(item => {
      const firstItem = item.items?.[0] || {};
      const title = item.title || firstItem.name || item.tenderTitle || '';
      const no = item.tenderNumber || item.tenderNo || '';
      const matchesSearch = title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            no.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesBranch = selectedBranch === 'ALL' || item.branchName === selectedBranch;
      const matchesStatus = selectedStatus === 'ALL' || String(item.tenderStatus) === selectedStatus;
      const matchesExpertise = !filterExpertiseOnly || (item.expertiseResult?.findings?.length > 0);

      return matchesSearch && matchesBranch && matchesStatus && matchesExpertise;
    })
    .sort((a, b) => {
      const priceA = a.price ?? a.startingAmount ?? a.itemStartingAmount ?? 0;
      const priceB = b.price ?? b.startingAmount ?? b.itemStartingAmount ?? 0;
      if (sortOption === 'price-asc') return priceA - priceB;
      if (sortOption === 'price-desc') return priceB - priceA;
      return 0;
    });

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="glass-panel app-header">
        <div className="brand-section">
          <div className="brand-badge">
            <Car size={26} color="#fff" />
          </div>
          <div>
            <h1 className="brand-title">e-İhale Araç Radar</h1>
            <p className="brand-subtitle">
              Ticaret Bakanlığı Canlı Araç İhaleleri • Toplam <b>{tenders.length}</b> Araç Bulundu
            </p>
          </div>
        </div>

        <div className="header-actions">
          <button 
            className="btn btn-secondary" 
            onClick={() => setIsModalOpen(true)}
            title="WhatsApp Bildirim Ayarları"
            style={{ 
              borderColor: waReady ? 'rgba(34, 197, 94, 0.4)' : 'rgba(234, 179, 8, 0.4)',
              color: waReady ? '#4ade80' : '#facc15'
            }}
          >
            <MessageSquare size={16} />
            {waReady ? 'WhatsApp: Bağlı' : (waStatus === 'qr' ? 'WhatsApp: QR Bekliyor' : 'WhatsApp Ayarları')}
          </button>

          <button 
            className="btn btn-secondary" 
            onClick={() => handleSendToWhatsApp()}
            disabled={sendingWA || tenders.length === 0 || !waReady}
            style={{ borderColor: 'rgba(37, 211, 102, 0.4)', color: '#25D366' }}
            title="İlan Edildi ve Teklif Verilebilir ilanları WhatsApp'a ilet"
          >
            <MessageCircle size={16} className={sendingWA ? 'spin' : ''} />
            {sendingWA ? 'Gönderiliyor...' : 'WhatsApp\'a Aktar'}
          </button>
          
          <button 
            className="btn btn-primary" 
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Taranıyor...' : 'Tüm Sayfaları Tara'}
          </button>
        </div>
      </header>

      {/* Durum Sekmeleri (Tümü / Teklif Verilebilir / İlan Edildi / Ekspertizli) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button 
          className={`btn ${selectedStatus === 'ALL' && !filterExpertiseOnly ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setSelectedStatus('ALL'); setFilterExpertiseOnly(false); }}
        >
          Tüm İhaleler ({tenders.length})
        </button>
        <button 
          className={`btn ${selectedStatus === '5' && !filterExpertiseOnly ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setSelectedStatus('5'); setFilterExpertiseOnly(false); }}
        >
          🟢 Teklif Verilebilir ({countTeklif})
        </button>
        <button 
          className={`btn ${selectedStatus === '3' && !filterExpertiseOnly ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setSelectedStatus('3'); setFilterExpertiseOnly(false); }}
        >
          🟡 İlan Edildi ({countIlan})
        </button>
        <button 
          className={`btn ${filterExpertiseOnly ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilterExpertiseOnly(!filterExpertiseOnly)}
          style={{ borderColor: '#ef4444', color: filterExpertiseOnly ? '#fff' : '#f87171' }}
        >
          📋 Ekspertiz Raporlu ({countWithExpertise})
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="controls-bar">
        <div className="search-input-wrapper">
          <Search size={18} />
          <input 
            type="text" 
            className="search-input"
            placeholder="Marka, model veya ihale no ile ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <select 
          className="select-filter"
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
        >
          {branches.map(b => (
            <option key={b} value={b}>{b === 'ALL' ? 'Tüm Müdürlükler / İller' : b}</option>
          ))}
        </select>

        <select 
          className="select-filter"
          value={sortOption}
          onChange={(e) => setSortOption(e.target.value)}
        >
          <option value="newest">Varsayılan Sıralama</option>
          <option value="price-asc">Fiyat: Düşükten Yükseğe</option>
          <option value="price-desc">Fiyat: Yüksekten Düşüğe</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
          <RefreshCw size={36} className="spin" style={{ margin: '0 auto 16px' }} />
          <p>İhale verileri yükleniyor...</p>
        </div>
      ) : filteredTenders.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Car size={48} color="#64748b" style={{ margin: '0 auto 16px' }} />
          <h3>İhale Bulunamadı</h3>
          <p style={{ color: '#94a3b8', marginTop: 8 }}>Arama kriterlerine uygun araç ihalesi bulunamadı veya henüz tarama tamamlanmadı.</p>
        </div>
      ) : (
        <div className="tender-grid">
          {filteredTenders.map((tender) => (
            <TenderCard key={tender.id || tender.tenderNumber} tender={tender} />
          ))}
        </div>
      )}

      {/* WhatsApp Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="glass-panel modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: '#25D366' }}>
                <MessageSquare size={20} color="#25D366" /> WhatsApp Bildirim Kurulumu
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            {/* Durum Rozeti */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 8,
              background: waReady ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)',
              border: `1px solid ${waReady ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
              marginBottom: 16
            }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: waReady ? '#22c55e' : (waStatus === 'qr' ? '#eab308' : '#ef4444')
              }}></span>
              <span style={{ fontSize: 13, fontWeight: 600, color: waReady ? '#4ade80' : '#facc15' }}>
                {waReady ? 'WhatsApp Bağlı ve Aktif' : (waStatus === 'qr' ? 'QR Kod Bekleniyor (Aşağıdan Tarayın)' : 'Bağlantı Kuruluyor...')}
              </span>
            </div>

            {/* QR Kod Alanı (Henüz bağlı değilse) */}
            {!waReady && waQR && (
              <div style={{ textAlign: 'center', margin: '16px 0', padding: 16, background: '#fff', borderRadius: 12 }}>
                <img src={waQR} alt="WhatsApp QR Kod" style={{ maxWidth: 220, height: 'auto', display: 'inline-block' }} />
                <p style={{ color: '#0f172a', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
                  WhatsApp &gt; Bağlı Cihazlar &gt; Cihaz Bağla ile okutun
                </p>
              </div>
            )}

            <form onSubmit={handleSaveWhatsApp} style={{ marginTop: 16 }}>
              <div className="form-group">
                <label>Hedef Telefon Numarası (Ülke kodu ile, örn: 905xxxxxxxxx)</label>
                <input 
                  type="text" 
                  className="form-input"
                  placeholder="905551234567"
                  value={whatsappNumber}
                  onChange={e => setWhatsappNumber(e.target.value)}
                  required
                />
              </div>

              {statusMessage && (
                <div style={{ marginBottom: 16, fontSize: 13, color: '#38bdf8' }}>
                  {statusMessage}
                </div>
              )}

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', justifyContent: 'center', background: '#25D366', borderColor: '#22c55e' }}
              >
                Numarayı Kaydet & Test Mesajı Gönder
              </button>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg) } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
