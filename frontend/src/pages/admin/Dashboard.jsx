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
      console.error('Admin fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
        <div className="spinner" />
        <span style={{ marginLeft: '0.75rem', color: '#64748B' }}>Loading Administrative Console...</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: '#1E293B', margin: 0 }}>
            Hospital Administration
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '0.2rem' }}>
            System Overview, Departments, Doctors & User Accounts
          </p>
        </div>

        <button
          onClick={fetchData}
          className="btn-secondary"
          style={{ padding: '0.45rem 0.9rem', fontSize: '0.82rem' }}
        >
          ↻ Refresh Data
        </button>
      </div>
      
      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', borderBottom: '1px solid #E2E8F0', paddingBottom: '0.75rem' }}>
        <Tab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
          📊 Overview
        </Tab>
        <Tab active={activeTab === 'departments'} onClick={() => setActiveTab('departments')}>
          🏢 Departments ({departments.length})
        </Tab>
        <Tab active={activeTab === 'doctors'} onClick={() => setActiveTab('doctors')}>
          👨‍⚕️ Doctors ({doctors.length})
        </Tab>
        <Tab active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
          👥 System Users ({users.length})
        </Tab>
      </div>

      {/* ── Tab 1: Overview ── */}
      {activeTab === 'overview' && stats && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1E293B', margin: 0 }}>
              Hospital Queue Metrics (Today)
            </h2>
            <span
              style={{
                background: '#CCFBF1',
                color: '#0F766E',
                border: '1px solid #99F6E4',
                padding: '0.25rem 0.75rem',
                borderRadius: '100px',
                fontSize: '0.75rem',
                fontWeight: '700'
              }}
            >
              ⚡ Phase 2 Virtual Queue Active
            </span>
          </div>

          <div className="status-grid" style={{ marginBottom: '2rem' }}>
            <StatCard label="Total Registered Patients" value={stats.total_patients} color="#1E293B" />
            <StatCard label="Active Virtual Queues" value={stats.active_virtual_queues ?? 0} color="#0D9488" />
            <StatCard label="Patients Waiting" value={stats.waiting} color="#F59E0B" />
            <StatCard label="Patients Consulting" value={stats.in_consultation} color="#0D9488" />
            <StatCard label="Consultations Completed" value={stats.completed} color="#10B981" />
            <StatCard label="Active Medical Staff" value={stats.total_doctors} color="#0284C7" />
          </div>
        </div>
      )}

      {/* ── Tab 2: Departments ── */}
      {activeTab === 'departments' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1E293B', margin: 0 }}>
              Hospital Departments
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
              Departments configured in system database
            </span>
          </div>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Department Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: '700', color: '#0F766E' }}>{d.code}</td>
                    <td style={{ fontWeight: '600' }}>{d.name}</td>
                    <td>
                      <span className="badge badge-completed">
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 3: Doctors ── */}
      {activeTab === 'doctors' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1E293B', margin: 0 }}>
              Doctor Directory
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
              Medical staff registered for virtual queuing
            </span>
          </div>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Doctor Name</th>
                  <th>Department</th>
                  <th>Specialization</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: '700', color: '#1E293B' }}>{d.name}</td>
                    <td style={{ color: '#0F766E', fontWeight: '500' }}>{d.department_name} ({d.department_code})</td>
                    <td style={{ color: '#64748B' }}>{d.specialization}</td>
                    <td>
                      <span className="badge badge-completed">
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 4: System Users ── */}
      {activeTab === 'users' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1E293B', margin: 0 }}>
              Authorized System Users
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
              Staff credentials and role access
            </span>
          </div>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Account Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: '700', color: '#1E293B' }}>{u.name}</td>
                    <td style={{ color: '#64748B' }}>{u.email}</td>
                    <td>
                      <span
                        style={{
                          background: u.role === 'ADMIN' ? '#EFF6FF' : u.role === 'DOCTOR' ? '#CCFBF1' : '#F1F5F9',
                          color: u.role === 'ADMIN' ? '#1D4ED8' : u.role === 'DOCTOR' ? '#0F766E' : '#334155',
                          border: `1px solid ${u.role === 'ADMIN' ? '#BFDBFE' : u.role === 'DOCTOR' ? '#99F6E4' : '#E2E8F0'}`,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '700'
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-completed">
                        {u.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#CCFBF1' : '#FFFFFF',
        color: active ? '#0F766E' : '#64748B',
        border: `1px solid ${active ? '#99F6E4' : '#E2E8F0'}`,
        padding: '0.5rem 1rem',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: active ? '700' : '500',
        fontSize: '0.85rem',
        transition: 'all 0.15s ease'
      }}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: '800', color, lineHeight: 1.15 }}>
        {value}
      </div>
    </div>
  );
}
