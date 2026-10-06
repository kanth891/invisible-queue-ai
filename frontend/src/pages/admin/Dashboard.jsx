import { useState, useEffect } from 'react';
import { queueAPI, departmentsAPI, doctorsAPI, usersAPI } from '../../services/api';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchData = async () => {
    try {
      const [statsRes, deptRes, docRes, usersRes] = await Promise.all([
        queueAPI.stats(),
        departmentsAPI.list(),
        doctorsAPI.list(),
        usersAPI.list()
      ]);
      setStats(statsRes.data);
      setDepartments(deptRes.data);
      setDoctors(docRes.data);
      setUsers(usersRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <h2 style={{ marginBottom: '1.5rem' }}>Admin Dashboard</h2>
      
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem' }}>
        <Tab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</Tab>
        <Tab active={activeTab === 'departments'} onClick={() => setActiveTab('departments')}>Departments</Tab>
        <Tab active={activeTab === 'doctors'} onClick={() => setActiveTab('doctors')}>Doctors</Tab>
        <Tab active={activeTab === 'users'} onClick={() => setActiveTab('users')}>Users</Tab>
      </div>

      {activeTab === 'overview' && stats && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: 'var(--text-secondary)' }}>Today's Statistics</h3>
            <span style={{
              background: 'rgba(99, 102, 241, 0.15)',
              color: 'var(--accent-indigo)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              padding: '0.25rem 0.75rem',
              borderRadius: '100px',
              fontSize: '0.75rem',
              fontWeight: '700'
            }}>
              ⚡ Phase 2 Virtual Queue Active
            </span>
          </div>

          <div className="status-grid" style={{ marginBottom: '2rem' }}>
            <StatCard label="Total Patients" value={stats.total_patients} color="var(--text-primary)" />
            <StatCard label="Active Virtual Queues" value={stats.active_virtual_queues ?? 0} color="var(--accent-violet)" />
            <StatCard label="Patients Currently Waiting" value={stats.waiting} color="var(--accent-amber)" />
            <StatCard label="Patients Currently Consulting" value={stats.in_consultation} color="var(--accent-cyan)" />
            <StatCard label="Patients Completed" value={stats.completed} color="var(--accent-emerald)" />
            <StatCard label="Active Doctors" value={stats.total_doctors} color="var(--accent-indigo)" />
          </div>
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3>Departments</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Management endpoints exist in API. UI creation omitted for brevity.</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem' }}>Code</th>
                <th style={{ padding: '0.75rem' }}>Name</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{d.code}</td>
                  <td style={{ padding: '0.75rem' }}>{d.name}</td>
                  <td style={{ padding: '0.75rem' }}>{d.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'doctors' && (
        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3>Doctors</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Management endpoints exist in API. UI creation omitted for brevity.</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem' }}>Name</th>
                <th style={{ padding: '0.75rem' }}>Department</th>
                <th style={{ padding: '0.75rem' }}>Specialization</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{d.name}</td>
                  <td style={{ padding: '0.75rem' }}>{d.department_name} ({d.department_code})</td>
                  <td style={{ padding: '0.75rem' }}>{d.specialization}</td>
                  <td style={{ padding: '0.75rem' }}>{d.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="status-card" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3>System Users</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Management endpoints exist in API. UI creation omitted for brevity.</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.75rem' }}>Name</th>
                <th style={{ padding: '0.75rem' }}>Email</th>
                <th style={{ padding: '0.75rem' }}>Role</th>
                <th style={{ padding: '0.75rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{u.name}</td>
                  <td style={{ padding: '0.75rem' }}>{u.email}</td>
                  <td style={{ padding: '0.75rem' }}>{u.role}</td>
                  <td style={{ padding: '0.75rem' }}>{u.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'var(--gradient-primary)' : 'transparent',
      color: active ? 'white' : 'var(--text-secondary)',
      border: 'none',
      padding: '0.5rem 1rem',
      borderRadius: '20px',
      cursor: 'pointer',
      fontWeight: active ? '600' : '400',
      transition: 'all 0.2s ease'
    }}>
      {children}
    </button>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="status-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '2rem', fontWeight: '800', color }}>{value}</div>
    </div>
  );
}
