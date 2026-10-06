import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { queueAPI } from '../../services/api';
import { StethoscopeIcon, CheckCircleIcon } from '../../components/Icons';

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchQueue = async () => {
    if (!user.doctorInfo?.doctor_id) return;
    try {
      const res = await queueAPI.doctorQueue(user.doctorInfo.doctor_id);
      setQueue(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const t = setInterval(fetchQueue, 8000);
    return () => clearInterval(t);
  }, [user.doctorInfo?.doctor_id]);

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
        <span style={{ marginLeft: '0.75rem', color: '#64748B' }}>Loading Consultation Room...</span>
      </div>
    );
  }

  const currentPatient = queue.find(q => ['CALLED', 'IN_CONSULTATION'].includes(q.status));
  const waitingPatients = queue.filter(q => q.status === 'WAITING');
  const completedPatients = queue.filter(q => ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(q.status));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.75rem' }}>
      
      {/* ── Main Area: Active Consultation & Waiting Queue ── */}
      <div>
        <div style={{ marginBottom: '1.25rem' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: '#1E293B', margin: 0 }}>
            Welcome, Dr. {user.name}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '0.2rem' }}>
            {user.doctorInfo?.department_name || 'Consultation Room'} • Live Patient Queue
          </p>
        </div>

        {/* Current Patient Card */}
        <div
          className="card"
          style={{
            padding: '1.75rem',
            marginBottom: '1.75rem',
            background: currentPatient ? '#F0FDFA' : '#FFFFFF',
            borderColor: currentPatient ? '#99F6E4' : '#E2E8F0'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: currentPatient ? '#0F766E' : '#64748B' }}>
              Current Consultation
            </span>
            {currentPatient && (
              <span
                style={{
                  background: currentPatient.status === 'CALLED' ? '#EFF6FF' : '#CCFBF1',
                  color: currentPatient.status === 'CALLED' ? '#1D4ED8' : '#0F766E',
                  border: `1px solid ${currentPatient.status === 'CALLED' ? '#BFDBFE' : '#99F6E4'}`,
                  padding: '0.25rem 0.65rem',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: '700'
                }}
              >
                {currentPatient.status === 'CALLED' ? '● CALLED (Waiting Entry)' : '● IN CONSULTATION'}
              </span>
            )}
          </div>
          
          {currentPatient ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '3.25rem', fontWeight: '900', color: '#0F766E', lineHeight: 1 }}>
                  {currentPatient.token_number}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#1E293B', marginTop: '0.4rem' }}>
                  {currentPatient.patient_name}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '0.2rem' }}>
                  Age: {currentPatient.patient_age} yrs • Gender: {currentPatient.patient_gender}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minWidth: '220px' }}>
                {currentPatient.status === 'CALLED' && (
                  <button
                    onClick={() => handleAction(currentPatient.id, 'start')}
                    disabled={actionLoading}
                    className="btn-primary"
                    style={{ padding: '0.75rem', fontSize: '0.9rem' }}
                  >
                    Start Consultation
                  </button>
                )}

                {currentPatient.status === 'IN_CONSULTATION' && (
                  <button
                    onClick={() => handleAction(currentPatient.id, 'complete')}
                    disabled={actionLoading}
                    style={{
                      background: '#10B981',
                      color: '#FFFFFF',
                      border: '1px solid #10B981',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem'
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
                  style={{ padding: '0.65rem', fontSize: '0.85rem' }}
                >
                  Mark as No-Show
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' }}>
                <StethoscopeIcon size={32} color="#0D9488" />
              </div>
              <div style={{ fontSize: '1rem', fontWeight: '600', color: '#1E293B', marginBottom: '0.25rem' }}>
                No Active Patient in Room
              </div>
              <div style={{ fontSize: '0.85rem', color: '#64748B', marginBottom: '1.25rem' }}>
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
                  opacity: waitingPatients.length > 0 ? 1 : 0.5
                }}
              >
                Call Next Patient ({waitingPatients[0]?.token_number || 'None'})
              </button>
            </div>
          )}
        </div>

        {/* Waiting Queue List */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1E293B', margin: 0 }}>
              Waiting Queue ({waitingPatients.length})
            </h2>
            <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
              Virtual alerts notify patients as they approach
            </span>
          </div>

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
                {waitingPatients.map(q => (
                  <tr key={q.id}>
                    <td style={{ fontWeight: '800', color: '#0F766E' }}>{q.token_number}</td>
                    <td>
                      <div style={{ fontWeight: '600', color: '#1E293B' }}>{q.patient_name}</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{q.patient_age} yrs • {q.patient_gender}</div>
                    </td>
                    <td>
                      <div className="status-indicator">
                        <span className="status-dot status-dot--waiting" />
                        <span>Waiting</span>
                      </div>
                    </td>
                    <td style={{ color: '#0F766E', fontSize: '0.82rem', fontWeight: '600' }}>
                      {q.predicted_wait_minutes !== undefined
                        ? (q.predicted_wait_minutes <= 2 ? 'Next in line' : `~${q.predicted_wait_minutes} min`)
                        : '—'}
                    </td>
                  </tr>
                ))}
                {waitingPatients.length === 0 && (
                  <tr>
                    <td colSpan="4" style={{ padding: '2rem', textAlign: 'center', color: '#64748B' }}>
                      No patients currently waiting in this room.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Sidebar: Today's Overview Metrics ── */}
      <div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#0F172A', marginBottom: '1rem' }}>
            Room Overview
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="clinical-stat-card" style={{ padding: '0.9rem 1rem' }}>
              <span className="clinical-stat-card__label">Waiting in Queue</span>
              <span className="clinical-stat-card__value" style={{ color: '#D97706' }}>
                {waitingPatients.length}
              </span>
            </div>

            <div className="clinical-stat-card" style={{ padding: '0.9rem 1rem' }}>
              <span className="clinical-stat-card__label">Completed Consultations</span>
              <span className="clinical-stat-card__value" style={{ color: '#10B981' }}>
                {completedPatients.filter(p => p.status === 'COMPLETED').length}
              </span>
            </div>

            <div className="clinical-stat-card" style={{ padding: '0.9rem 1rem' }}>
              <span className="clinical-stat-card__label">No-Shows / Cancelled</span>
              <span className="clinical-stat-card__value" style={{ color: '#64748B' }}>
                {completedPatients.filter(p => p.status !== 'COMPLETED').length}
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
