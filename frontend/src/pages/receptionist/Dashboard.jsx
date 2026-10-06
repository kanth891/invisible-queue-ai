import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { queueAPI, departmentsAPI, doctorsAPI, patientsAPI } from '../../services/api';
import { CopyIcon, PrinterIcon, QrCodeIcon, AlertTriangleIcon, CheckCircleIcon, CloseIcon } from '../../components/Icons';

export default function ReceptionistDashboard() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const fetchData = async () => {
    try {
      const [queueRes, statsRes, deptRes, docRes] = await Promise.all([
        queueAPI.list(),
        queueAPI.stats(),
        departmentsAPI.list('ACTIVE'),
        doctorsAPI.list({ status: 'ACTIVE' })
      ]);
      setQueue(queueRes.data);
      setStats(statsRes.data);
      setDepartments(deptRes.data);
      setDoctors(docRes.data);
    } catch (err) {
      console.error('Receptionist fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 8000); // Auto refresh queue
    return () => clearInterval(t);
  }, []);

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
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px; color: #1E293B; }
            .hospital { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; color: #0F5147; margin-bottom: 2px; }
            .subtitle { font-size: 11px; color: #64748B; margin-bottom: 16px; letter-spacing: 0.04em; text-transform: uppercase; }
            .token-box { margin: 16px 0; padding: 14px; border: 1.5px solid #0D9488; border-radius: 8px; background: #F0FDFA; }
            .token-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0F766E; letter-spacing: 0.05em; }
            .token { font-size: 48px; font-weight: 900; letter-spacing: 0.02em; margin: 4px 0; color: #0F5147; }
            .info { font-size: 12px; text-align: left; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 12px; border-radius: 6px; margin: 16px 0; line-height: 1.6; }
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
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(queueUrl)}" alt="QR Code" width="130" height="130" style="display: inline-block; border: 1px solid #CBD5E1; border-radius: 6px; padding: 6px; background: #fff;" />
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
        <span style={{ marginLeft: '0.75rem', color: '#64748B' }}>Loading Outpatient Queue...</span>
      </div>
    );
  }

  const filteredDoctors = doctors.filter(d => d.department_id === parseInt(formData.department_id));

  return (
    <div>
      {/* ── Apollo-Style Overview Cards ── */}
      {stats && (
        <div className="stat-card-row">
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">Today's Registered</span>
            <span className="clinical-stat-card__value">{stats.total_patients}</span>
          </div>
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">Waiting in Queue</span>
            <span className="clinical-stat-card__value" style={{ color: '#D97706' }}>{stats.waiting}</span>
          </div>
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">In Consultation</span>
            <span className="clinical-stat-card__value" style={{ color: '#0D9488' }}>{stats.in_consultation}</span>
          </div>
          <div className="clinical-stat-card">
            <span className="clinical-stat-card__label">Completed Visits</span>
            <span className="clinical-stat-card__value" style={{ color: '#10B981' }}>{stats.completed}</span>
          </div>
        </div>
      )}

      {/* ── Main Two-Column Layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Left Column: Intake Registration */}
        <div className="card" style={{ padding: '1.35rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0F172A', marginBottom: '0.35rem' }}>
            Patient Intake & Token
          </h2>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginBottom: '1.25rem' }}>
            Register outpatient and generate virtual queue pass
          </p>
          
          {/* Success Banner with QR Code & Remote Queue Link */}
          {message && message.type === 'success' && (
            <div
              style={{
                background: '#F0FDFA',
                border: '1px solid #CCFBF1',
                padding: '1.15rem',
                borderRadius: '8px',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#0F766E', fontWeight: '700', fontSize: '0.85rem' }}>
                  <CheckCircleIcon size={15} color="#0F766E" />
                  <span>Token Generated</span>
                </span>
                <button
                  onClick={() => setMessage(null)}
                  style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  title="Dismiss"
                >
                  <CloseIcon size={14} color="#64748B" />
                </button>
              </div>

              {/* Prominent Token Display */}
              <div style={{ textAlign: 'center', marginBottom: '0.85rem' }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', fontWeight: '600' }}>
                  Outpatient Token
                </div>
                <div style={{ fontSize: '2.4rem', fontWeight: '900', color: '#0F5147', lineHeight: 1.1, margin: '0.1rem 0' }}>
                  {message.data.token_number}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#1E293B', fontWeight: '600' }}>
                  {message.data.doctor_name}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#0284C7' }}>
                  {message.data.department_name}
                </div>
              </div>

              {/* QR Code Container */}
              {message.data.queue_access_token && (
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    margin: '0.65rem 0'
                  }}
                >
                  <QRCodeSVG
                    value={`${window.location.origin}/queue/${message.data.queue_access_token}`}
                    size={130}
                    level="M"
                    includeMargin={false}
                  />
                  <div style={{ color: '#475569', fontSize: '0.72rem', fontWeight: '500', marginTop: '0.4rem', textAlign: 'center' }}>
                    Scan with phone camera to track queue
                  </div>
                </div>
              )}

              {/* Action Buttons: Copy Link & Print */}
              {message.data.queue_access_token && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.65rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${window.location.origin}/queue/${message.data.queue_access_token}`)}
                      className="btn-secondary"
                      style={{ flex: 1, padding: '0.45rem', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                    >
                      <CopyIcon size={13} color="currentColor" />
                      <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => printTokenSlip(message.data)}
                      className="btn-primary"
                      style={{ flex: 1, padding: '0.45rem', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
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
                      fontSize: '0.75rem',
                      color: '#0D9488',
                      textDecoration: 'underline',
                      marginTop: '0.2rem',
                      fontWeight: '500'
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
                color: '#991B1B',
                border: '1px solid #FECACA',
                padding: '0.65rem 0.8rem',
                borderRadius: '6px',
                marginBottom: '1rem',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}
            >
              <AlertTriangleIcon size={15} color="#DC2626" />
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

            <div style={{ display: 'flex', gap: '0.65rem' }}>
              <div style={{ flex: 1 }}>
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
              <div style={{ flex: 1 }}>
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
              style={{ width: '100%', marginTop: '0.4rem', padding: '0.65rem' }}
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

        {/* Right Column: Clean Clinical Queue Table */}
        <div className="card" style={{ padding: '1.35rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0F172A', margin: 0 }}>
                Live Outpatient Queue
              </h2>
              <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.15rem' }}>
                Real-time queue sequence and remote digital pass status
              </p>
            </div>
            <button
              onClick={fetchData}
              className="btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
            >
              ↻ Refresh
            </button>
          </div>

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
                {queue.map(q => (
                  <tr key={q.id}>
                    {/* Token */}
                    <td style={{ fontWeight: '700', color: '#0F5147', fontSize: '0.9rem' }}>
                      {q.token_number}
                    </td>

                    {/* Patient */}
                    <td>
                      <div style={{ fontWeight: '600', color: '#0F172A' }}>{q.patient_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                        {q.patient_age ? `${q.patient_age} yrs` : ''} {q.patient_gender ? `• ${q.patient_gender}` : ''}
                      </div>
                    </td>

                    {/* Doctor */}
                    <td style={{ color: '#1E293B' }}>{q.doctor_name}</td>

                    {/* Department */}
                    <td style={{ color: '#64748B', fontSize: '0.8rem' }}>{q.department_name}</td>

                    {/* Clinical Status Indicator (No Candy Pills!) */}
                    <td>
                      <div className="status-indicator">
                        <span className={`status-dot ${getStatusDotClass(q.status)}`} />
                        <span>{formatStatus(q.status)}</span>
                      </div>
                    </td>

                    {/* Digital Pass Button (Single line, Sleek) */}
                    <td>
                      {q.queue_access_token ? (
                        <button
                          onClick={() => { setActiveQRModal(q); setModalCopied(false); }}
                          className="table-action-btn"
                        >
                          <QrCodeIcon size={13} color="#0D9488" />
                          <span>Queue Pass</span>
                        </button>
                      ) : (
                        <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>—</span>
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
                        <span style={{ color: '#CBD5E1', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ padding: '2.5rem', textAlign: 'center', color: '#64748B' }}>
                      No outpatient entries registered in queue today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ── QR Code Pass Modal ── */}
      {activeQRModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#0D9488', fontWeight: '700' }}>
                  Outpatient Digital Pass
                </span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: '#0F172A' }}>
                  Token {activeQRModal.token_number}
                </h3>
              </div>
              <button
                onClick={() => setActiveQRModal(null)}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <CloseIcon size={16} color="#64748B" />
              </button>
            </div>

            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.85rem', marginBottom: '1rem', textAlign: 'left' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0F172A' }}>
                {activeQRModal.patient_name}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.15rem' }}>
                {activeQRModal.doctor_name} • {activeQRModal.department_name}
              </div>
            </div>

            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                padding: '1.1rem',
                display: 'inline-block',
                margin: '0 auto 0.85rem auto'
              }}
            >
              <QRCodeSVG
                value={`${window.location.origin}/queue/${activeQRModal.queue_access_token}`}
                size={160}
                level="M"
              />
            </div>

            <div style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '1.25rem', lineHeight: 1.4 }}>
              Patient can scan this code with their phone camera to monitor their live queue position remotely.
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem' }}>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/queue/${activeQRModal.queue_access_token}`, true)}
                className="btn-secondary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', fontSize: '0.82rem' }}
              >
                <CopyIcon size={14} color="currentColor" />
                <span>{modalCopied ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                onClick={() => printTokenSlip(activeQRModal)}
                className="btn-primary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', fontSize: '0.82rem' }}
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
                fontSize: '0.78rem',
                color: '#0D9488',
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
  marginBottom: '0.3rem',
  fontSize: '0.78rem',
  fontWeight: '600',
  color: '#334155'
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
