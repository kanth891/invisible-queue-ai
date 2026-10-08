import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { queueAPI, departmentsAPI, doctorsAPI, patientsAPI } from '../../services/api';
import socketService, { SOCKET_EVENTS } from '../../services/socket';
import { CopyIcon, PrinterIcon, QrCodeIcon, AlertTriangleIcon, CheckCircleIcon, CloseIcon, RefreshIcon } from '../../components/Icons';

export default function ReceptionistDashboard() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const isMounted = useRef(true);

  // New Patient Form State
  const [formData, setFormData] = useState({
    name: '', age: '', gender: 'MALE', phone: '', department_id: '', doctor_id: ''
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Modal state for viewing QR of any queue patient
  const [activeQRModal, setActiveQRModal] = useState(null);
  const [modalCopied, setModalCopied] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [queueRes, statsRes, deptRes, docRes] = await Promise.all([
        queueAPI.list(),
        queueAPI.stats(),
        departmentsAPI.list('ACTIVE'),
        doctorsAPI.list({ status: 'ACTIVE' })
      ]);
      if (isMounted.current) {
        setQueue(queueRes.data);
        setStats(statsRes.data);
        setDepartments(deptRes.data);
        setDoctors(docRes.data);
      }
    } catch (err) {
      console.error('Receptionist fetch error:', err);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    fetchData();

    // Connect to Socket.IO and listen for real-time queue changes
    const socket = socketService.connect();

    const unsubStatus = socketService.subscribeStatus((st) => {
      if (isMounted.current) setSocketStatus(st);
    });

    const unsubReconnect = socketService.onReconnect(() => {
      fetchData();
    });

    const handleQueueUpdated = () => {
      if (isMounted.current) fetchData();
    };

    socket.on(SOCKET_EVENTS.QUEUE_UPDATED, handleQueueUpdated);

    // Fallback refresh interval (20s)
    const t = setInterval(fetchData, 20000);

    return () => {
      isMounted.current = false;
      clearInterval(t);
      unsubStatus();
      unsubReconnect();
      socket.off(SOCKET_EVENTS.QUEUE_UPDATED, handleQueueUpdated);
    };
  }, [fetchData]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterLoading(true);
    setMessage(null);
    setCopiedLink(false);
    try {
      // 1. Create Patient
      const patientRes = await patientsAPI.create({
        name: formData.name,
        age: formData.age,
        gender: formData.gender,
        phone: formData.phone
      });
      
      // 2. Generate Token / Create Queue Entry
      const tokenRes = await queueAPI.generateToken({
        patient_id: patientRes.data.id,
        doctor_id: formData.doctor_id,
        department_id: formData.department_id
      });

      setMessage({ type: 'success', data: tokenRes.data });
      setFormData({ name: '', age: '', gender: 'MALE', phone: '', department_id: '', doctor_id: '' });
      fetchData(); // Refresh queue
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setRegisterLoading(false);
    }
  };

  const cancelToken = async (id) => {
    if (!confirm('Are you sure you want to cancel this token?')) return;
    try {
      await queueAPI.cancel(id);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const copyToClipboard = async (text, isModal = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isModal) {
        setModalCopied(true);
        setTimeout(() => setModalCopied(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch (err) {
      prompt('Copy this link:', text);
    }
  };

  const printTokenSlip = (tokenData) => {
    const queueUrl = `${window.location.origin}/queue/${tokenData.queue_access_token}`;
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    if (!printWindow) {
      alert('Pop-up was blocked. Please allow pop-ups for this site to print tokens.');
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Outpatient Pass - ${tokenData.token_number}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px; color: #0F172A; }
            .hospital { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: #1E3A8A; margin-bottom: 2px; }
            .subtitle { font-size: 11px; color: #64748B; margin-bottom: 16px; letter-spacing: 0.04em; text-transform: uppercase; }
            .token-box { margin: 16px 0; padding: 14px; border: 1.5px solid #2563EB; border-radius: 8px; background: #EFF6FF; }
            .token-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #1D4ED8; letter-spacing: 0.05em; }
            .token { font-size: 48px; font-weight: 900; letter-spacing: 0.02em; margin: 4px 0; color: #1D4ED8; }
            .info { font-size: 12px; text-align: left; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 12px; border-radius: 8px; margin: 16px 0; line-height: 1.6; }
            .instructions { font-size: 11px; color: #475569; margin-top: 14px; line-height: 1.4; border-top: 1px solid #E2E8F0; padding-top: 12px; }
            .url { font-size: 10px; color: #64748B; margin-top: 8px; word-break: break-all; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="hospital">Invisible Queue AI</div>
          <div class="subtitle">Smart Hospital Virtual Queue System</div>
          <div class="token-box">
            <div class="token-label">Outpatient Token</div>
            <div class="token">${tokenData.token_number}</div>
          </div>
          <div class="info">
            <div><strong>Patient:</strong> ${tokenData.patient_name || 'Patient'}</div>
            <div><strong>Doctor:</strong> ${tokenData.doctor_name || 'Assigned Physician'}</div>
            <div><strong>Department:</strong> ${tokenData.department_name || 'Department'}</div>
            <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
          </div>
          <div style="margin: 14px auto; text-align: center;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(queueUrl)}" alt="QR Code" width="130" height="130" style="display: inline-block; border: 1px solid #CBD5E1; border-radius: 8px; padding: 6px; background: #fff;" />
          </div>
          <div class="instructions">
            <strong>Scan the QR code to track your queue remotely.</strong><br/>
            You do not need to wait near the consultation room.<br/>
            Return when your turn approaches.
          </div>
          <div class="url">${queueUrl}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);
  };

  if (loading && !queue.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
        <div className="spinner" />
        <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>Loading Outpatient Queue...</span>
      </div>
    );
  }

  const filteredDoctors = doctors.filter(d => d.department_id === parseInt(formData.department_id));

  return (
    <div>
      {/* ── Reception Header with Real-Time Indicator ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            Outpatient Reception Desk
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Live Patient Intake, Digital Token Passes & Department Queues
          </p>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            background: socketStatus === 'connected' ? '#EFF6FF' : '#FEF3C7',
            border: `1px solid ${socketStatus === 'connected' ? '#BFDBFE' : '#FDE68A'}`,
            padding: '0.35rem 0.75rem',
            borderRadius: 'var(--radius-full)',
            fontSize: '0.75rem',
            fontWeight: '700',
            color: socketStatus === 'connected' ? '#1D4ED8' : '#B45309',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: socketStatus === 'connected' ? '#10B981' : '#F59E0B',
            }}
          />
          <span>{socketStatus === 'connected' ? 'Live Connected' : 'Reconnecting...'}</span>
        </div>
      </div>

      {/* ── Clinical Overview Cards ── */}
      {stats && (
        <div className="stat-card-row">
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">Today's Registered</span>
            <span className="clinical-stat-card__value" style={{ color: 'var(--text-primary)' }}>{stats.total_patients}</span>
          </div>
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">Waiting in Queue</span>
            <span className="clinical-stat-card__value" style={{ color: '#D97706' }}>{stats.waiting}</span>
          </div>
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">In Consultation</span>
            <span className="clinical-stat-card__value" style={{ color: '#2563EB' }}>{stats.in_consultation}</span>
          </div>
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">Completed Visits</span>
            <span className="clinical-stat-card__value" style={{ color: '#059669' }}>{stats.completed}</span>
          </div>
        </div>
      )}

      {/* ── Main Two-Column Layout ── */}
      <div className="receptionist-layout">
        
        {/* Left Column: Intake Registration */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.35rem', letterSpacing: '-0.01em' }}>
            Patient Intake & Token
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.35rem' }}>
            Register outpatient and generate virtual queue pass
          </p>
          
          {/* Success Banner with QR Code & Remote Queue Link */}
          {message && message.type === 'success' && (
            <div
              style={{
                background: 'linear-gradient(135deg, #F0F9FF 0%, #FFFFFF 100%)',
                border: '1px solid #BAE6FD',
                boxShadow: '0 8px 25px rgba(2, 132, 199, 0.1)',
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1.35rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: '#059669', fontWeight: '700', fontSize: '0.85rem' }}>
                  <CheckCircleIcon size={16} color="#059669" />
                  <span>Token Generated Successfully</span>
                </span>
                <button
                  onClick={() => setMessage(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: '32px', minHeight: '32px', justifyContent: 'center' }}
                  title="Dismiss"
                >
                  <CloseIcon size={14} color="currentColor" />
                </button>
              </div>

              {/* Prominent Token Display */}
              <div style={{ textAlign: 'center', marginBottom: '0.95rem' }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Outpatient Token
                </div>
                <div style={{
                  fontSize: 'clamp(2.4rem, 8vw, 3rem)',
                  fontWeight: '900',
                  background: 'linear-gradient(135deg, #1D4ED8 0%, #0284C7 60%, #0EA5E9 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  lineHeight: 1.1,
                  margin: '0.2rem 0',
                  fontFamily: "'Outfit', sans-serif"
                }}>
                  {message.data.token_number}
                </div>
                <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: '800', wordBreak: 'break-word' }}>
                  {message.data.doctor_name}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#0284C7', fontWeight: '600', marginTop: '0.15rem' }}>
                  {message.data.department_name}
                </div>
              </div>

              {/* QR Code Container */}
              {message.data.queue_access_token && (
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.9rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    margin: '0.75rem 0',
                    boxShadow: '0 2px 10px rgba(15, 23, 42, 0.05)'
                  }}
                >
                  <QRCodeSVG
                    value={`${window.location.origin}/queue/${message.data.queue_access_token}`}
                    size={130}
                    level="M"
                    includeMargin={false}
                  />
                  <div style={{ color: '#475569', fontSize: '0.72rem', fontWeight: '600', marginTop: '0.5rem', textAlign: 'center' }}>
                    Scan with phone camera to track live queue
                  </div>
                </div>
              )}

              {/* Action Buttons: Copy Link & Print */}
              {message.data.queue_access_token && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${window.location.origin}/queue/${message.data.queue_access_token}`)}
                      className="btn-secondary"
                      style={{ flex: 1, minHeight: '42px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                    >
                      <CopyIcon size={13} color="currentColor" />
                      <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => printTokenSlip(message.data)}
                      className="btn-primary"
                      style={{ flex: 1, minHeight: '42px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                    >
                      <PrinterIcon size={13} color="#FFFFFF" />
                      <span>Print Pass</span>
                    </button>
                  </div>

                  <a
                    href={`/queue/${message.data.queue_access_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textAlign: 'center',
                      fontSize: '0.78rem',
                      color: '#2563EB',
                      textDecoration: 'underline',
                      marginTop: '0.4rem',
                      fontWeight: '600',
                      padding: '0.2rem'
                    }}
                  >
                    Open Live Patient Tracker ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {message && message.type === 'error' && (
            <div
              style={{
                background: '#FEF2F2',
                color: '#B91C1C',
                border: '1px solid #FECACA',
                padding: '0.75rem 0.95rem',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <AlertTriangleIcon size={16} color="#DC2626" />
              <span>{message.text}</span>
            </div>
          )}

          {/* Registration Form */}
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label style={labelStyle}>Patient Full Name</label>
              <input
                required
                className="input-control"
                placeholder="e.g. Ramesh Kumar"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.65rem' }}>
              <div>
                <label style={labelStyle}>Age</label>
                <input
                  required
                  type="number"
                  className="input-control"
                  placeholder="e.g. 42"
                  min="1"
                  max="150"
                  value={formData.age}
                  onChange={e => setFormData({ ...formData, age: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>Gender</label>
                <select
                  className="input-control"
                  value={formData.gender}
                  onChange={e => setFormData({ ...formData, gender: e.target.value })}
                >
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Contact Phone</label>
              <input
                required
                type="tel"
                className="input-control"
                placeholder="e.g. 9876543210"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <div>
              <label style={labelStyle}>Department</label>
              <select
                required
                className="input-control"
                value={formData.department_id}
                onChange={e => setFormData({ ...formData, department_id: e.target.value, doctor_id: '' })}
              >
                <option value="">Select Department...</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Consulting Physician</label>
              <select
                required
                className="input-control"
                value={formData.doctor_id}
                onChange={e => setFormData({ ...formData, doctor_id: e.target.value })}
                disabled={!formData.department_id}
              >
                <option value="">Select Doctor...</option>
                {filteredDoctors.map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>)}
              </select>
            </div>

            <button
              type="submit"
              disabled={registerLoading}
              className="btn-primary"
              style={{ width: '100%', marginTop: '0.4rem', minHeight: '46px' }}
            >
              {registerLoading ? (
                <>
                  <span className="spinner" style={{ width: '14px', height: '14px', borderTopColor: '#FFFFFF' }} />
                  <span>Issuing Token...</span>
                </>
              ) : (
                'Generate Outpatient Token'
              )}
            </button>
          </form>
        </div>

        {/* Right Column: Clean Clinical Queue Display */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                Live Outpatient Queue ({queue.length})
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Real-time queue sequence and remote digital pass status
              </p>
            </div>
            <button
              onClick={fetchData}
              className="btn-secondary"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', minHeight: '38px', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <RefreshIcon size={13} color="currentColor" />
              <span>Refresh</span>
            </button>
          </div>

          {/* Desktop Table View (>= 768px) */}
          <div className="table-desktop-view">
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Patient Name</th>
                    <th>Physician</th>
                    <th>Department</th>
                    <th>Queue Status</th>
                    <th>Digital Pass</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.length > 0 ? (
                    queue.map((q) => (
                      <tr key={`recep-queue-${q.id}`}>
                        {/* Token */}
                        <td style={{ fontWeight: '800', color: '#2563EB', fontSize: '0.92rem', fontFamily: "'Outfit', sans-serif" }}>
                          {q.token_number}
                        </td>

                        {/* Patient */}
                        <td>
                          <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{q.patient_name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {q.patient_age ? `${q.patient_age} yrs` : ''} {q.patient_gender ? `• ${q.patient_gender}` : ''}
                          </div>
                        </td>

                        {/* Doctor */}
                        <td style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{q.doctor_name}</td>

                        {/* Department */}
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{q.department_name}</td>

                        {/* Clinical Status Indicator */}
                        <td>
                          <div className="status-indicator">
                            <span className={`status-dot ${getStatusDotClass(q.status)}`} />
                            <span>{formatStatus(q.status)}</span>
                          </div>
                        </td>

                        {/* Digital Pass Button */}
                        <td>
                          {q.queue_access_token ? (
                            <button
                              onClick={() => { setActiveQRModal(q); setModalCopied(false); }}
                              className="table-action-btn"
                            >
                              <QrCodeIcon size={13} color="#2563EB" />
                              <span>Queue Pass</span>
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                          )}
                        </td>

                        {/* Action */}
                        <td style={{ textAlign: 'right' }}>
                          {q.status === 'WAITING' ? (
                            <button
                              onClick={() => cancelToken(q.id)}
                              className="table-cancel-btn"
                            >
                              Cancel
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr key="recep-empty-queue">
                      <td colSpan="7" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No outpatient entries registered in queue today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (< 768px) */}
          <div className="cards-mobile-view">
            {queue.map(q => (
              <div key={q.id} className="mobile-queue-card">
                <div className="mobile-queue-card__header">
                  <span className="mobile-queue-card__token">{q.token_number}</span>
                  <div className="status-indicator">
                    <span className={`status-dot ${getStatusDotClass(q.status)}`} />
                    <span style={{ fontSize: '0.8rem', fontWeight: '700' }}>{formatStatus(q.status)}</span>
                  </div>
                </div>

                <div className="mobile-queue-card__body">
                  <div className="mobile-queue-card__patient">{q.patient_name}</div>
                  <div className="mobile-queue-card__meta">
                    <span>{q.patient_age ? `${q.patient_age} yrs` : ''} {q.patient_gender ? `• ${q.patient_gender}` : ''}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                    <strong>Doctor:</strong> {q.doctor_name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#2563EB', marginTop: '0.1rem', fontWeight: '600' }}>
                    <strong>Dept:</strong> {q.department_name}
                  </div>
                </div>

                <div className="mobile-queue-card__actions">
                  {q.queue_access_token && (
                    <button
                      onClick={() => { setActiveQRModal(q); setModalCopied(false); }}
                      className="table-action-btn"
                      style={{ flex: 1, minHeight: '40px' }}
                    >
                      <QrCodeIcon size={14} color="#2563EB" />
                      <span>Queue Pass</span>
                    </button>
                  )}
                  {q.status === 'WAITING' && (
                    <button
                      onClick={() => cancelToken(q.id)}
                      className="table-cancel-btn"
                      style={{ flex: q.queue_access_token ? 'none' : 1, minHeight: '40px' }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
            {queue.length === 0 && (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No outpatient entries registered in queue today.
              </div>
            )}
          </div>

        </div>

      </div>

      {/* ── QR Code Pass Modal ── */}
      {activeQRModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center', background: '#FFFFFF', border: '1px solid #E2E8F0', boxShadow: '0 20px 50px rgba(15, 23, 42, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem' }}>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#2563EB', fontWeight: '700' }}>
                  Outpatient Digital Pass
                </span>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '-0.01em', fontFamily: "'Outfit', sans-serif" }}>
                  Token {activeQRModal.token_number}
                </h3>
              </div>
              <button
                onClick={() => setActiveQRModal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '36px', minHeight: '36px' }}
                aria-label="Close Modal"
              >
                <CloseIcon size={16} color="currentColor" />
              </button>
            </div>

            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 'var(--radius-md)', padding: '0.9rem', marginBottom: '1.1rem', textAlign: 'left' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {activeQRModal.patient_name}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {activeQRModal.doctor_name} • {activeQRModal.department_name}
              </div>
            </div>

            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: 'var(--radius-md)',
                padding: '1.25rem',
                display: 'inline-block',
                margin: '0 auto 1rem auto',
                boxShadow: '0 4px 14px rgba(15, 23, 42, 0.06)'
              }}
            >
              <QRCodeSVG
                value={`${window.location.origin}/queue/${activeQRModal.queue_access_token}`}
                size={160}
                level="M"
              />
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.35rem', lineHeight: 1.45 }}>
              Patient can scan this code with their phone camera to monitor their live queue position remotely.
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.95rem' }}>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/queue/${activeQRModal.queue_access_token}`, true)}
                className="btn-secondary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
              >
                <CopyIcon size={14} color="currentColor" />
                <span>{modalCopied ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                onClick={() => printTokenSlip(activeQRModal)}
                className="btn-primary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
              >
                <PrinterIcon size={14} color="#FFFFFF" />
                <span>Print Pass</span>
              </button>
            </div>

            <a
              href={`/queue/${activeQRModal.queue_access_token}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.8rem',
                color: '#2563EB',
                textDecoration: 'underline',
                fontWeight: '600'
              }}
            >
              Open Live Tracker Page ↗
            </a>
          </div>
        </div>
      )}

    </div>
  );
}

const labelStyle = {
  display: 'block',
  marginBottom: '0.35rem',
  fontSize: '0.78rem',
  fontWeight: '700',
  color: 'var(--text-secondary)'
};

function getStatusDotClass(status) {
  switch (status) {
    case 'WAITING': return 'status-dot--waiting';
    case 'CALLED': return 'status-dot--called';
    case 'IN_CONSULTATION': return 'status-dot--consultation';
    case 'COMPLETED': return 'status-dot--completed';
    case 'CANCELLED': return 'status-dot--cancelled';
    default: return 'status-dot--noshow';
  }
}

function formatStatus(status) {
  switch (status) {
    case 'WAITING': return 'Waiting';
    case 'CALLED': return 'Called';
    case 'IN_CONSULTATION': return 'In Consultation';
    case 'COMPLETED': return 'Completed';
    case 'CANCELLED': return 'Cancelled';
    case 'NO_SHOW': return 'No Show';
    default: return status;
  }
}
