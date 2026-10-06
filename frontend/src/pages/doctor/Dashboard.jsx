import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { queueAPI } from '../../services/api';
import socketService, { SOCKET_EVENTS } from '../../services/socket';
import { useNotifications } from '../../context/NotificationContext';
import { StethoscopeIcon, CheckCircleIcon, PulseIcon } from '../../components/Icons';

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const { notify } = useNotifications();
  const isMounted = useRef(true);

  const fetchQueue = useCallback(async () => {
    if (!user.doctorInfo?.doctor_id) return;
    try {
      const res = await queueAPI.doctorQueue(user.doctorInfo.doctor_id);
      if (isMounted.current) setQueue(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [user.doctorInfo?.doctor_id]);

  useEffect(() => {
    isMounted.current = true;
    fetchQueue();

    const docId = user.doctorInfo?.doctor_id;
    if (!docId) return;

    // Connect to Socket.IO and join doctor room
    const socket = socketService.connect();
    socketService.joinDoctor(docId);

    const unsubStatus = socketService.subscribeStatus((st) => {
      if (isMounted.current) setSocketStatus(st);
    });

    const unsubReconnect = socketService.onReconnect(() => {
      fetchQueue();
    });

    const handleQueueUpdated = (payload) => {
      if (!isMounted.current) return;
      fetchQueue();
      if (payload?.action === 'NEW_PATIENT') {
        notify({
          type: 'INFO',
          title: 'New Patient Arrived',
          message: 'A new patient has been added to your queue.',
        });
      }
    };

    socket.on(SOCKET_EVENTS.QUEUE_UPDATED, handleQueueUpdated);

    // Fallback polling (20s)
    const t = setInterval(fetchQueue, 20000);

    return () => {
      isMounted.current = false;
      clearInterval(t);
      unsubStatus();
      unsubReconnect();
      socket.off(SOCKET_EVENTS.QUEUE_UPDATED, handleQueueUpdated);
    };
  }, [user.doctorInfo?.doctor_id, fetchQueue, notify]);

  const handleAction = async (id, action) => {
    try {
      setActionLoading(true);
      await queueAPI[action](id);
      await fetchQueue();
    } catch (err) {
      alert(err.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCallNext = async () => {
    const nextWaiting = queue.find(q => q.status === 'WAITING');
    if (!nextWaiting) return alert('No waiting patients found.');
    await handleAction(nextWaiting.id, 'call');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
        <div className="spinner" />
        <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>Loading Consultation Room...</span>
      </div>
    );
  }

  const currentPatient = queue.find(q => ['CALLED', 'IN_CONSULTATION'].includes(q.status));
  const waitingPatients = queue.filter(q => q.status === 'WAITING');
  const completedPatients = queue.filter(q => ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(q.status));

  return (
    <div className="doctor-layout">
      
      {/* ── Main Area: Active Consultation & Waiting Queue ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
              Welcome, {user.name.startsWith('Dr.') ? user.name : `Dr. ${user.name}`}
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              {user.doctorInfo?.department_name || 'Consultation Room'} • Live Patient Queue
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
              borderRadius: '100px',
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

        {/* Current Patient Card */}
        <div
          className="card"
          style={{
            padding: '1.6rem',
            marginBottom: '1.5rem',
            background: currentPatient
              ? 'linear-gradient(135deg, #F0F9FF 0%, #FFFFFF 100%)'
              : '#FFFFFF',
            border: `1px solid ${currentPatient ? '#BAE6FD' : 'var(--border-subtle)'}`,
            boxShadow: currentPatient
              ? '0 10px 30px rgba(2, 132, 199, 0.10), 0 0 0 1px #BAE6FD'
              : 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', color: currentPatient ? '#0284C7' : 'var(--text-secondary)' }}>
              Current Consultation Room
            </span>
            {currentPatient && (
              <span
                style={{
                  background: currentPatient.status === 'CALLED' ? '#EFF6FF' : '#ECFDF5',
                  color: currentPatient.status === 'CALLED' ? '#1D4ED8' : '#047857',
                  border: `1px solid ${currentPatient.status === 'CALLED' ? '#BFDBFE' : '#A7F3D0'}`,
                  padding: '0.3rem 0.75rem',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  letterSpacing: '0.02em',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: currentPatient.status === 'CALLED' ? '#2563EB' : '#10B981',
                      display: 'inline-block',
                    }}
                  />
                  <span>{currentPatient.status === 'CALLED' ? 'CALLED (Waiting Entry)' : 'IN CONSULTATION'}</span>
                </span>
              </span>
            )}
          </div>
          
          {currentPatient ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
              <div style={{ minWidth: '180px' }}>
                <div style={{
                  fontSize: 'clamp(2.6rem, 10vw, 3.5rem)',
                  fontWeight: '900',
                  background: 'linear-gradient(135deg, #1D4ED8 0%, #0284C7 60%, #0EA5E9 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  fontFamily: "'Outfit', sans-serif"
                }}>
                  {currentPatient.token_number}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', marginTop: '0.5rem', wordBreak: 'break-word', letterSpacing: '-0.01em' }}>
                  {currentPatient.patient_name}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Age: {currentPatient.patient_age} yrs • Gender: {currentPatient.patient_gender}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', width: '100%', maxWidth: '280px', flexShrink: 0 }}>
                {currentPatient.status === 'CALLED' && (
                  <button
                    onClick={() => handleAction(currentPatient.id, 'start')}
                    disabled={actionLoading}
                    className="btn-primary"
                    style={{ width: '100%', minHeight: '48px', fontSize: '0.92rem' }}
                  >
                    Start Consultation
                  </button>
                )}

                {currentPatient.status === 'IN_CONSULTATION' && (
                  <button
                    onClick={() => handleAction(currentPatient.id, 'complete')}
                    disabled={actionLoading}
                    style={{
                      background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)',
                      color: '#FFFFFF',
                      border: 'none',
                      boxShadow: '0 4px 14px rgba(5, 150, 105, 0.28)',
                      padding: '0.75rem',
                      minHeight: '48px',
                      borderRadius: '8px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '0.92rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      width: '100%',
                      fontFamily: "'Outfit', sans-serif",
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}
                  >
                    <CheckCircleIcon size={16} color="#FFFFFF" />
                    <span>Complete Consultation</span>
                  </button>
                )}

                <button
                  onClick={() => handleAction(currentPatient.id, 'noShow')}
                  disabled={actionLoading}
                  className="btn-secondary"
                  style={{ width: '100%', minHeight: '44px', fontSize: '0.85rem' }}
                >
                  Mark as No-Show
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.1)'
                }}>
                  <StethoscopeIcon size={30} color="#2563EB" />
                </div>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.35rem', fontFamily: "'Outfit', sans-serif" }}>
                No Active Patient in Room
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                {waitingPatients.length > 0
                  ? `${waitingPatients.length} patient(s) waiting in your virtual queue.`
                  : 'Your queue is currently clear.'}
              </div>
              <button
                onClick={handleCallNext}
                disabled={actionLoading || waitingPatients.length === 0}
                className="btn-primary"
                style={{
                  padding: '0.75rem 1.75rem',
                  fontSize: '0.95rem',
                  minHeight: '48px',
                  width: '100%',
                  maxWidth: '340px',
                  opacity: waitingPatients.length > 0 ? 1 : 0.45
                }}
              >
                Call Next Patient ({waitingPatients[0]?.token_number || 'None'})
              </button>
            </div>
          )}
        </div>

        {/* Waiting Queue List */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Waiting Queue ({waitingPatients.length})
            </h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Virtual alerts notify patients as their turn approaches
            </span>
          </div>

          {/* Desktop Table View (>= 768px) */}
          <div className="table-desktop-view">
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Patient Details</th>
                    <th>Status</th>
                    <th>Estimated Wait</th>
                  </tr>
                </thead>
                <tbody>
                  {waitingPatients.length > 0 ? (
                    waitingPatients.map((q) => (
                      <tr key={`doc-wait-${q.id}`}>
                        <td style={{ fontWeight: '800', color: '#2563EB', fontFamily: "'Outfit', sans-serif" }}>{q.token_number}</td>
                        <td>
                          <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{q.patient_name}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{q.patient_age} yrs • {q.patient_gender}</div>
                        </td>
                        <td>
                          <div className="status-indicator">
                            <span className="status-dot status-dot--waiting" />
                            <span style={{ fontWeight: '600', color: '#B45309' }}>Waiting</span>
                          </div>
                        </td>
                        <td style={{ color: '#059669', fontSize: '0.82rem', fontWeight: '700' }}>
                          {q.predicted_wait_minutes !== undefined
                            ? (q.predicted_wait_minutes <= 2 ? 'Next in line' : `~${q.predicted_wait_minutes} min`)
                            : '—'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr key="doc-empty-queue">
                      <td colSpan="4" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No patients currently waiting in this room.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (< 768px) */}
          <div className="cards-mobile-view">
            {waitingPatients.map(q => (
              <div key={q.id} className="mobile-queue-card">
                <div className="mobile-queue-card__header">
                  <span className="mobile-queue-card__token">{q.token_number}</span>
                  <div className="status-indicator">
                    <span className="status-dot status-dot--waiting" />
                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#B45309' }}>Waiting</span>
                  </div>
                </div>

                <div className="mobile-queue-card__body">
                  <div className="mobile-queue-card__patient">{q.patient_name}</div>
                  <div className="mobile-queue-card__meta">
                    <span>{q.patient_age} yrs • {q.patient_gender}</span>
                  </div>
                  <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#059669', fontWeight: '700' }}>
                    <span>Estimated Wait:</span>
                    <span>
                      {q.predicted_wait_minutes !== undefined
                        ? (q.predicted_wait_minutes <= 2 ? 'Next in line' : `~${q.predicted_wait_minutes} min`)
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {waitingPatients.length === 0 && (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No patients currently waiting in this room.
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Sidebar: Room Overview Metrics ── */}
      <div>
        <div className="card" style={{ padding: '1.35rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '1rem', letterSpacing: '-0.01em' }}>
            Room Overview
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
            <div className="clinical-stat-card" style={{ padding: '0.9rem 1rem' }}>
              <span className="clinical-stat-card__label">Waiting in Queue</span>
              <span className="clinical-stat-card__value" style={{ color: '#D97706' }}>
                {waitingPatients.length}
              </span>
            </div>

            <div className="clinical-stat-card" style={{ padding: '0.9rem 1rem' }}>
              <span className="clinical-stat-card__label">Completed</span>
              <span className="clinical-stat-card__value" style={{ color: '#059669' }}>
                {completedPatients.filter(p => p.status === 'COMPLETED').length}
              </span>
            </div>

            <div className="clinical-stat-card" style={{ padding: '0.9rem 1rem' }}>
              <span className="clinical-stat-card__label">No-Shows</span>
              <span className="clinical-stat-card__value" style={{ color: 'var(--text-secondary)' }}>
                {completedPatients.filter(p => p.status !== 'COMPLETED').length}
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
