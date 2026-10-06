import { useState, useEffect } from 'react';
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
      console.error(err);
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

  if (loading && !queue.length) return <div className="spinner" />;

  const filteredDoctors = doctors.filter(d => d.department_id === parseInt(formData.department_id));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '2rem' }}>
      
      {/* Registration Panel */}
      <div>
        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--accent-cyan)' }}>Register Patient</h3>
          
          {message && message.type === 'success' && (
            <div style={{ background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52,211,153,0.3)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <div style={{ color: 'var(--accent-emerald)', fontWeight: 'bold', marginBottom: '0.5rem' }}>Patient Registered Successfully</div>
              <div style={{ fontSize: '0.9rem' }}>
                Token: <strong style={{color:'white'}}>{message.data.token_number}</strong><br/>
                Patient: {message.data.patient_name}<br/>
                Doctor: {message.data.doctor_name}<br/>
                Department: {message.data.department_name}
              </div>
            </div>
          )}

          {message && message.type === 'error' && (
            <div style={{ background: 'rgba(251, 113, 133, 0.1)', color: 'var(--accent-rose)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem' }}>
              {message.text}
            </div>
          )}

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
              {registerLoading ? 'Processing...' : 'Generate Token'}
            </button>
          </form>
        </div>

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
          </div>
        )}
      </div>

      {/* Queue View */}
      <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Today's Queue</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem' }}>Token</th>
                <th style={{ padding: '0.75rem' }}>Patient</th>
                <th style={{ padding: '0.75rem' }}>Doctor</th>
                <th style={{ padding: '0.75rem' }}>Department</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
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
                    {q.status === 'WAITING' && (
                      <button onClick={() => cancelToken(q.id)} style={{ background: 'none', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No patients in queue today.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
