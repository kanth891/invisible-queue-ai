import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { queueAPI, departmentsAPI, doctorsAPI, patientsAPI } from '../../services/api';

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
    const t = setInterval(fetchData, 10000); // Auto refresh queue
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
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px; color: #111; }
            .hospital { font-size: 20px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
            .subtitle { font-size: 11px; color: #666; margin-bottom: 16px; letter-spacing: 0.05em; text-transform: uppercase; }
            .token-box { margin: 16px 0; padding: 14px; border: 2px dashed #111; border-radius: 8px; }
            .token-label { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #555; }
            .token { font-size: 52px; font-weight: 900; letter-spacing: 0.05em; margin: 4px 0; }
            .info { font-size: 13px; text-align: left; background: #f5f5f7; padding: 12px; border-radius: 6px; margin: 16px 0; line-height: 1.6; }
            .qr-container { margin: 16px auto; }
            .instructions { font-size: 12px; color: #444; margin-top: 14px; line-height: 1.4; border-top: 1px solid #ddd; padding-top: 12px; }
            .url { font-size: 10px; color: #777; margin-top: 8px; word-break: break-all; }
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
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(queueUrl)}" alt="QR Code" width="140" height="140" style="display: inline-block; border: 1px solid #ddd; border-radius: 8px; padding: 6px; background: #fff;" />
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

  if (loading && !queue.length) return <div className="spinner" />;

  const filteredDoctors = doctors.filter(d => d.department_id === parseInt(formData.department_id));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '2rem' }}>
      
      {/* Registration Panel */}
      <div>
        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--accent-cyan)' }}>Register Patient</h3>
          
          {/* Success Banner with QR Code & Remote Queue Link */}
          {message && message.type === 'success' && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.12) 0%, rgba(16, 185, 129, 0.05) 100%)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              padding: '1.25rem',
              borderRadius: '12px',
              marginBottom: '1.25rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--accent-emerald)', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  ✓ Patient Registered Successfully
                </span>
                <button
                  onClick={() => setMessage(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>

              {/* Prominent Token Display */}
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-secondary)' }}>
                  Assigned Token
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'white', lineHeight: 1.2 }}>
                  {message.data.token_number}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', marginTop: '0.2rem' }}>
                  {message.data.doctor_name} • {message.data.department_name}
                </div>
              </div>

              {/* QR Code Container */}
              {message.data.queue_access_token && (
                <div style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  margin: '0.75rem 0'
                }}>
                  <QRCodeSVG
                    value={`${window.location.origin}/queue/${message.data.queue_access_token}`}
                    size={160}
                    level="M"
                    includeMargin={false}
                  />
                  <div style={{ color: '#111827', fontSize: '0.75rem', fontWeight: '600', marginTop: '0.5rem', textAlign: 'center' }}>
                    Scan with phone camera to track queue
                  </div>
                </div>
              )}

              {/* Actions: Copy Link & Print */}
              {message.data.queue_access_token && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`${window.location.origin}/queue/${message.data.queue_access_token}`)}
                      style={{
                        flex: 1,
                        padding: '0.6rem',
                        background: copiedLink ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.1)',
                        color: 'white',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.3rem'
                      }}
                    >
                      {copiedLink ? '✓ Copied!' : '📋 Copy Queue Link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => printTokenSlip(message.data)}
                      style={{
                        flex: 1,
                        padding: '0.6rem',
                        background: 'rgba(99, 102, 241, 0.2)',
                        color: 'white',
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.3rem'
                      }}
                    >
                      🖨️ Print Slip
                    </button>
                  </div>

                  <a
                    href={`/queue/${message.data.queue_access_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textAlign: 'center',
                      fontSize: '0.8rem',
                      color: 'var(--accent-cyan)',
                      textDecoration: 'underline',
                      marginTop: '0.25rem'
                    }}
                  >
                    Open Patient Tracker Page ↗
                  </a>
                </div>
              )}
            </div>
          )}

          {message && message.type === 'error' && (
            <div style={{ background: 'rgba(251, 113, 133, 0.1)', color: 'var(--accent-rose)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
              {message.text}
            </div>
          )}

          {/* Registration Form */}
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input required placeholder="Patient Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={inputStyle} />
            <div style={{ display: 'flex', gap: '1rem' }}>
              <input required type="number" placeholder="Age" min="1" max="150" value={formData.age} onChange={e => setFormData({...formData, age: e.target.value})} style={{...inputStyle, flex: 1}} />
              <select value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})} style={{...inputStyle, flex: 1}}>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <input required placeholder="Phone Number" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} style={inputStyle} />
            
            <select required value={formData.department_id} onChange={e => setFormData({...formData, department_id: e.target.value, doctor_id: ''})} style={inputStyle}>
              <option value="">Select Department...</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            
            <select required value={formData.doctor_id} onChange={e => setFormData({...formData, doctor_id: e.target.value})} style={inputStyle} disabled={!formData.department_id}>
              <option value="">Select Doctor...</option>
              {filteredDoctors.map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>)}
            </select>

            <button type="submit" disabled={registerLoading} style={{ padding: '0.75rem', background: 'var(--accent-indigo)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
              {registerLoading ? 'Processing...' : 'Generate Token & QR Code'}
            </button>
          </form>
        </div>

        {/* Stats Panel */}
        {stats && (
          <div className="status-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="status-card" style={{ padding: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Today's Total Patients</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.total_patients}</div>
              </div>
            </div>
            <div className="status-card" style={{ padding: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Currently Waiting</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-amber)' }}>{stats.waiting}</div>
              </div>
            </div>
            <div className="status-card" style={{ padding: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>In Consultation</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-cyan)' }}>{stats.in_consultation}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Queue View */}
      <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>Today's Virtual Queue</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Patients can monitor status remotely via secure QR access links
            </span>
          </div>
          <button
            onClick={fetchData}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            ↻ Refresh
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem' }}>Token</th>
                <th style={{ padding: '0.75rem' }}>Patient</th>
                <th style={{ padding: '0.75rem' }}>Doctor</th>
                <th style={{ padding: '0.75rem' }}>Department</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
                <th style={{ padding: '0.75rem' }}>Virtual Queue</th>
                <th style={{ padding: '0.75rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(q => (
                <tr key={q.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{q.token_number}</td>
                  <td style={{ padding: '0.75rem' }}>{q.patient_name}</td>
                  <td style={{ padding: '0.75rem' }}>{q.doctor_name}</td>
                  <td style={{ padding: '0.75rem' }}>{q.department_name}</td>
                  <td style={{ padding: '0.75rem' }}>
                    <span style={getStatusStyle(q.status)}>{q.status}</span>
                  </td>
                  <td style={{ padding: '0.75rem' }}>
                    {q.queue_access_token ? (
                      <button
                        onClick={() => { setActiveQRModal(q); setModalCopied(false); }}
                        style={{
                          background: 'rgba(99, 102, 241, 0.15)',
                          border: '1px solid rgba(99, 102, 241, 0.3)',
                          color: 'var(--accent-indigo)',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                      >
                        📱 View QR / Link
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem' }}>
                    {q.status === 'WAITING' && (
                      <button
                        onClick={() => cancelToken(q.id)}
                        style={{
                          background: 'none',
                          border: '1px solid var(--accent-rose)',
                          color: 'var(--accent-rose)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.8rem'
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No patients in queue today.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* QR Code Modal for any Queue Patient */}
      {activeQRModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(5px)'
        }}>
          <div style={{
            background: 'var(--bg-card, #111827)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '16px',
            padding: '2rem',
            maxWidth: '400px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Patient Virtual Queue</h3>
              <button
                onClick={() => setActiveQRModal(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'white', marginBottom: '0.2rem' }}>
              {activeQRModal.token_number}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {activeQRModal.patient_name} • {activeQRModal.doctor_name}
            </div>

            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'inline-block',
              margin: '0 auto 1.25rem auto'
            }}>
              <QRCodeSVG
                value={`${window.location.origin}/queue/${activeQRModal.queue_access_token}`}
                size={180}
                level="M"
              />
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Scan with mobile phone to monitor live queue position remotely.
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <button
                onClick={() => copyToClipboard(`${window.location.origin}/queue/${activeQRModal.queue_access_token}`, true)}
                style={{
                  flex: 1,
                  padding: '0.65rem',
                  background: modalCopied ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600'
                }}
              >
                {modalCopied ? '✓ Copied' : '📋 Copy Link'}
              </button>
              <button
                onClick={() => printTokenSlip(activeQRModal)}
                style={{
                  flex: 1,
                  padding: '0.65rem',
                  background: 'var(--accent-indigo)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600'
                }}
              >
                🖨️ Print Slip
              </button>
            </div>

            <a
              href={`/queue/${activeQRModal.queue_access_token}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.8rem',
                color: 'var(--accent-cyan)',
                textDecoration: 'underline'
              }}
            >
              Open Tracker in New Tab ↗
            </a>
          </div>
        </div>
      )}

    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', 
  border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'white'
};

function getStatusStyle(status) {
  const base = { padding: '0.2rem 0.5rem', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 'bold' };
  switch(status) {
    case 'WAITING': return { ...base, background: 'rgba(251,191,36,0.1)', color: 'var(--accent-amber)' };
    case 'CALLED': return { ...base, background: 'rgba(167,139,250,0.1)', color: 'var(--accent-violet)' };
    case 'IN_CONSULTATION': return { ...base, background: 'rgba(52,211,153,0.1)', color: 'var(--accent-emerald)' };
    case 'COMPLETED': return { ...base, background: 'rgba(148,163,184,0.1)', color: 'var(--text-secondary)' };
    default: return { ...base, background: 'rgba(251,113,133,0.1)', color: 'var(--accent-rose)' };
  }
}
