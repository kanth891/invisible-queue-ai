import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { queueAPI } from '../../services/api';

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
    const t = setInterval(fetchQueue, 10000);
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

  if (loading) return <div className="spinner" />;

  const currentPatient = queue.find(q => ['CALLED', 'IN_CONSULTATION'].includes(q.status));
  const waitingPatients = queue.filter(q => q.status === 'WAITING');
  const completedPatients = queue.filter(q => ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(q.status));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '2rem' }}>
      
      {/* Current Patient & Queue */}
      <div>
        <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-primary)' }}>
          Welcome, {user.name} <span style={{fontSize: '1rem', color: 'var(--text-muted)'}}>({user.doctorInfo?.department_name})</span>
        </h2>

        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '2rem', marginBottom: '2rem', background: currentPatient ? 'var(--gradient-primary)' : 'var(--bg-card)' }}>
          <h3 style={{ marginBottom: '1rem', color: currentPatient ? 'white' : 'var(--text-secondary)' }}>Current Patient</h3>
          
          {currentPatient ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '3rem', fontWeight: '800', lineHeight: 1 }}>{currentPatient.token_number}</div>
                <div style={{ fontSize: '1.25rem', marginTop: '0.5rem', fontWeight: '500' }}>{currentPatient.patient_name}</div>
                <div style={{ opacity: 0.8, fontSize: '0.9rem', marginTop: '0.25rem' }}>Age: {currentPatient.patient_age} | {currentPatient.patient_gender}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '200px' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px', textAlign: 'center', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                  Status: {currentPatient.status.replace('_', ' ')}
                </div>
                
                {currentPatient.status === 'CALLED' && (
                  <button onClick={() => handleAction(currentPatient.id, 'start')} disabled={actionLoading} style={btnStyle('var(--accent-emerald)')}>
                    Start Consultation
                  </button>
                )}
                {currentPatient.status === 'IN_CONSULTATION' && (
                  <button onClick={() => handleAction(currentPatient.id, 'complete')} disabled={actionLoading} style={btnStyle('var(--accent-cyan)')}>
                    Complete Consultation
                  </button>
                )}
                <button onClick={() => handleAction(currentPatient.id, 'noShow')} disabled={actionLoading} style={btnStyle('rgba(255,255,255,0.2)')}>
                  Mark No-Show
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
              No active consultation.
              <div style={{ marginTop: '1rem' }}>
                <button onClick={handleCallNext} disabled={actionLoading || waitingPatients.length === 0} style={{ padding: '1rem 2rem', fontSize: '1.1rem', background: 'var(--accent-indigo)', color: 'white', border: 'none', borderRadius: '8px', cursor: waitingPatients.length > 0 ? 'pointer' : 'not-allowed', opacity: waitingPatients.length > 0 ? 1 : 0.5, fontWeight: 'bold' }}>
                  Call Next Patient
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Waiting Queue ({waitingPatients.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.75rem' }}>Token</th>
                  <th style={{ padding: '0.75rem' }}>Patient</th>
                  <th style={{ padding: '0.75rem' }}>Wait Time (Est.)</th>
                </tr>
              </thead>
              <tbody>
                {waitingPatients.map(q => (
                  <tr key={q.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{q.token_number}</td>
                    <td style={{ padding: '0.75rem' }}>{q.patient_name} ({q.patient_age}{q.patient_gender[0]})</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Phase 3 Feature</td>
                  </tr>
                ))}
                {waitingPatients.length === 0 && (
                  <tr>
                    <td colSpan="3" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>No more patients waiting.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sidebar Stats */}
      <div>
        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>Today's Overview</h3>
          
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Waiting</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-amber)' }}>{waitingPatients.length}</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Completed</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-emerald)' }}>{completedPatients.filter(p => p.status === 'COMPLETED').length}</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No Shows / Cancelled</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{completedPatients.filter(p => p.status !== 'COMPLETED').length}</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

const btnStyle = (bg) => ({
  background: bg,
  color: 'white',
  border: 'none',
  padding: '0.75rem',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
  width: '100%',
  textAlign: 'center'
});
