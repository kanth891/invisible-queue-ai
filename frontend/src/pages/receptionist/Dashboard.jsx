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
          <title>Token Slip - ${tokenData.token_number}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px; color: #1E293B; }
            .hospital { font-size: 20px; font-weight: 800; letter-spacing: 0.02em; color: #0F766E; margin-bottom: 2px; }
            .subtitle { font-size: 11px; color: #64748B; margin-bottom: 16px; letter-spacing: 0.05em; text-transform: uppercase; }
            .token-box { margin: 16px 0; padding: 14px; border: 2px dashed #0D9488; border-radius: 8px; background: #F0FDFA; }
            .token-label { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #0F766E; }
            .token { font-size: 52px; font-weight: 900; letter-spacing: 0.05em; margin: 4px 0; color: #0F766E; }
            .info { font-size: 13px; text-align: left; background: #F8FAFC; border: 1px solid #E2E8F0; padding: 12px; border-radius: 6px; margin: 16px 0; line-height: 1.6; }
            .qr-container { margin: 16px auto; }
            .instructions { font-size: 12px; color: #475569; margin-top: 14px; line-height: 1.4; border-top: 1px solid #E2E8F0; padding-top: 12px; }
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
            <div class="token-label">Digital Queue Token</div>
            <div class="token">${tokenData.token_number}</div>
          </div>
          <div class="info">
            <div><strong>Patient:</strong> ${tokenData.patient_name || 'Patient'}</div>
            <div><strong>Doctor:</strong> ${tokenData.doctor_name || 'Assigned Doctor'}</div>
            <div><strong>Department:</strong> ${tokenData.department_name || 'Department'}</div>
            <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
          </div>
          <div style="margin: 14px auto; text-align: center;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(queueUrl)}" alt="QR Code" width="140" height="140" style="display: inline-block; border: 1px solid #CBD5E1; border-radius: 8px; padding: 6px; background: #fff;" />
          </div>
          <div class="instructions">
            <strong>Scan the QR code to monitor your queue remotely!</strong><br/>
            You do NOT need to wait near the consultation room.<br/>
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
        <span style={{ marginLeft: '0.75rem', color: '#64748B' }}>Loading Receptionist Portal...</span>
      </div>
    );
  }

  const filteredDoctors = doctors.filter(d => d.department_id === parseInt(formData.department_id));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.75rem' }}>
      
      {/* ── Left Column: Registration & Statistics ── */}
      <div>
        {/* Registration Card */}
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', marginBottom: '1rem', color: '#1E293B' }}>
            Register Patient & Token
          </h2>
          
          {/* Success Banner with QR Code & Remote Queue Link */}
          {message && message.type === 'success' && (
            <div
              style={{
                background: '#F0FDFA',
                border: '1px solid #99F6E4',
                padding: '1.25rem',
                borderRadius: '12px',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#0F766E', fontWeight: '700', fontSize: '0.9rem' }}>
                  <CheckCircleIcon size={16} color="#0F766E" />
                  <span>Token Generated Successfully</span>
                </span>
                <button
                  onClick={() => setMessage(null)}
                  style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  title="Dismiss"
                >
                  <CloseIcon size={16} color="#64748B" />
                </button>
              </div>

              {/* Prominent Token Display */}
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', fontWeight: '600' }}>
                  Assigned Token
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: '900', color: '#0F766E', lineHeight: 1.15, margin: '0.1rem 0' }}>
                  {message.data.token_number}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#1E293B', fontWeight: '500' }}>
                  {message.data.doctor_name}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#0284C7' }}>
                  {message.data.department_name}
                </div>
              </div>

              {/* QR Code Container */}
              {message.data.queue_access_token && (
                <div
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '10px',
                    padding: '0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    margin: '0.75rem 0'
                  }}
                >
                  <QRCodeSVG
                    value={`${window.location.origin}/queue/${message.data.queue_access_token}`}
                    size={140}
                    level="M"
                    includeMargin={false}
                  />
                  <div style={{ color: '#475569', fontSize: '0.75rem', fontWeight: '600', marginTop: '0.5rem', textAlign: 'center' }}>
                    Scan with phone for virtual queue
                  </div>
                </div>
              )}

              {/* Action Buttons: Copy Link & Print */}
              {message.data.queue_access_token && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${window.location.origin}/queue/${message.data.queue_access_token}`)}
                      className="btn-secondary"
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                    >
                      <CopyIcon size={13} color="currentColor" />
                      <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => printTokenSlip(message.data)}
                      className="btn-primary"
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                    >
                      <PrinterIcon size={13} color="#FFFFFF" />
                      <span>Print Slip</span>
                    </button>
                  </div>

                  <a
                    href={`/queue/${message.data.queue_access_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textAlign: 'center',
                      fontSize: '0.78rem',
                      color: '#0D9488',
                      textDecoration: 'underline',
                      marginTop: '0.2rem',
                      fontWeight: '600'
                    }}
                  >
                    Open Patient Tracker Page ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {message && message.type === 'error' && (
            <div
              style={{
                background: '#FEE2E2',
                color: '#991B1B',
                border: '1px solid #FECACA',
                padding: '0.75rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                fontSize: '0.85rem',
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

            <div style={{ display: 'flex', gap: '0.75rem' }}>
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
              <label style={labelStyle}>Phone Number</label>
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
              <label style={labelStyle}>Assigned Doctor</label>
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
              style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }}
            >
              {registerLoading ? (
                <>
                  <span className="spinner" style={{ width: '14px', height: '14px', borderTopColor: '#FFFFFF' }} />
                  Issuing Token...
                </>
              ) : (
                'Generate Token & QR Code'
              )}
            </button>
          </form>
        </div>

        {/* Quick Stats Panel */}
        {stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', color: '#64748B' }}>
                Today's Total Registered
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#1E293B', marginTop: '0.2rem' }}>
                {stats.total_patients}
              </div>
            </div>

            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', color: '#64748B' }}>
                Currently Waiting
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#F59E0B', marginTop: '0.2rem' }}>
                {stats.waiting}
              </div>
            </div>

            <div className="card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', color: '#64748B' }}>
                In Active Consultation
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#0D9488', marginTop: '0.2rem' }}>
                {stats.in_consultation}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Right Column: Queue View Table ── */}
      <div className="card" style={{ padding: '1.5rem', alignSelf: 'start' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#1E293B', margin: 0 }}>
              Live Virtual Queue
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.2rem' }}>
              Patients track progress remotely via encrypted QR access links
            </p>
          </div>
          <button
            onClick={fetchData}
            className="btn-secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
          >
            ↻ Refresh Queue
          </button>
        </div>

        <div className="table-container">
          <table className="modern-table">
            <thead>
              <tr>
                <th>Token</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Department</th>
                <th>Status</th>
                <th>Virtual Queue</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(q => (
                <tr key={q.id}>
                  <td style={{ fontWeight: '800', color: '#0F766E' }}>{q.token_number}</td>
                  <td style={{ fontWeight: '600' }}>{q.patient_name}</td>
                  <td>{q.doctor_name}</td>
                  <td style={{ color: '#64748B' }}>{q.department_name}</td>
                  <td>
                    <span className={`badge ${getBadgeClass(q.status)}`}>
                      {formatStatus(q.status)}
                    </span>
                  </td>
                  <td>
                    {q.queue_access_token ? (
                      <button
                        onClick={() => { setActiveQRModal(q); setModalCopied(false); }}
                        className="btn-secondary"
                        style={{
                          padding: '0.3rem 0.65rem',
                          fontSize: '0.76rem',
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}
                      >
                        <QrCodeIcon size={13} color="currentColor" />
                        <span>QR & Link</span>
                      </button>
                    ) : (
                      <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                  <td>
                    {q.status === 'WAITING' ? (
                      <button
                        onClick={() => cancelToken(q.id)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #FECACA',
                          color: '#EF4444',
                          padding: '0.25rem 0.55rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '0.76rem',
                          fontWeight: '600'
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ padding: '2.5rem', textAlign: 'center', color: '#64748B' }}>
                    No patient tokens registered today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── QR Code Modal ── */}
      {activeQRModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1E293B' }}>
                Virtual Queue Token
              </h3>
              <button
                onClick={() => setActiveQRModal(null)}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <CloseIcon size={18} color="#64748B" />
              </button>
            </div>

            <div style={{ fontSize: '2.5rem', fontWeight: '900', color: '#0F766E', margin: '0.25rem 0' }}>
              {activeQRModal.token_number}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#1E293B', fontWeight: '600' }}>
              {activeQRModal.patient_name}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748B', marginBottom: '1rem' }}>
              {activeQRModal.doctor_name} • {activeQRModal.department_name}
            </div>

            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '1.25rem',
                display: 'inline-block',
                margin: '0 auto 1rem auto'
              }}
            >
              <QRCodeSVG
                value={`${window.location.origin}/queue/${activeQRModal.queue_access_token}`}
                size={180}
                level="M"
              />
            </div>

            <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '1.25rem', lineHeight: 1.4 }}>
              Patient can scan this code with their phone camera to track their queue position from anywhere.
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.85rem' }}>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/queue/${activeQRModal.queue_access_token}`, true)}
                className="btn-secondary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
              >
                <CopyIcon size={14} color="currentColor" />
                <span>{modalCopied ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                onClick={() => printTokenSlip(activeQRModal)}
                className="btn-primary"
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
              >
                <PrinterIcon size={14} color="#FFFFFF" />
                <span>Print Slip</span>
              </button>
            </div>

            <a
              href={`/queue/${activeQRModal.queue_access_token}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.8rem',
                color: '#0D9488',
                textDecoration: 'underline',
                fontWeight: '600'
              }}
            >
              Open Live Patient Tracker ↗
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
  fontSize: '0.8rem',
  fontWeight: '600',
  color: '#1E293B'
};

function getBadgeClass(status) {
  switch (status) {
    case 'WAITING': return 'badge-waiting';
    case 'CALLED': return 'badge-called';
    case 'IN_CONSULTATION': return 'badge-consultation';
    case 'COMPLETED': return 'badge-completed';
    case 'CANCELLED': return 'badge-cancelled';
    default: return 'badge-noshow';
  }
}

function formatStatus(status) {
  switch (status) {
    case 'IN_CONSULTATION': return 'In Consultation';
    case 'NO_SHOW': return 'No Show';
    default: return status.charAt(0) + status.slice(1).toLowerCase();
  }
}
