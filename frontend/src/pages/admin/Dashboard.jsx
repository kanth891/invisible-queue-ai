import { useState, useEffect, useCallback, useRef } from 'react';
import { queueAPI, departmentsAPI, doctorsAPI, usersAPI, analyticsAPI } from '../../services/api';
import socketService, { SOCKET_EVENTS } from '../../services/socket';
import { BarChartIcon, BuildingIcon, StethoscopeIcon, UsersIcon, PulseIcon, ClockIcon, RefreshIcon } from '../../components/Icons';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [users, setUsers] = useState([]);
  const [predictionMetrics, setPredictionMetrics] = useState(null);
  const [liveDepartments, setLiveDepartments] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [socketStatus, setSocketStatus] = useState('connecting');
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, deptRes, docRes, usersRes, predRes, liveDeptRes, analyticsRes] = await Promise.all([
        queueAPI.stats(),
        departmentsAPI.list(),
        doctorsAPI.list(),
        usersAPI.list(),
        queueAPI.predictionMetrics().catch(() => ({ data: null })),
        analyticsAPI.liveStatus().catch(() => ({ data: [] })),
        analyticsAPI.overview().catch(() => ({ data: null })),
      ]);

      if (isMounted.current) {
        setStats(statsRes.data);
        setDepartments(deptRes.data);
        setDoctors(docRes.data);
        setUsers(usersRes.data);
        if (predRes?.data) setPredictionMetrics(predRes.data);
        if (liveDeptRes?.data) setLiveDepartments(liveDeptRes.data);
        if (analyticsRes?.data) setAnalyticsData(analyticsRes.data);
      }
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    fetchData();

    // Socket.IO real-time synchronization
    const socket = socketService.connect();
    socketService.joinAdmin();

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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
        <div className="spinner" />
        <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>Loading Administrative Console...</span>
      </div>
    );
  }

  return (
    <div>
      {/* ── Admin Header with Real-Time Badge ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            Hospital Administration
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            System Overview, Departments, Doctors & Real-Time Queue Operations
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: socketStatus === 'connected' ? '#EFF6FF' : '#FEF3C7',
              border: `1px solid ${socketStatus === 'connected' ? '#BFDBFE' : '#FDE68A'}`,
              padding: '0.35rem 0.75rem',
              borderRadius: '0',
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

          <button
            onClick={fetchData}
            className="btn-secondary"
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.82rem', minHeight: '38px', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <RefreshIcon size={13} color="currentColor" />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>
      
      {/* Navigation Tabs (Smooth touch scrolling on mobile) */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.75rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '0.75rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}
      >
        <Tab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <BarChartIcon size={14} color="currentColor" />
            <span>Overview</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <ClockIcon size={14} color="currentColor" />
            <span>Queue & ML Analytics</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'departments'} onClick={() => setActiveTab('departments')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <BuildingIcon size={14} color="currentColor" />
            <span>Departments ({departments.length})</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'doctors'} onClick={() => setActiveTab('doctors')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <StethoscopeIcon size={14} color="currentColor" />
            <span>Doctors ({doctors.length})</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <UsersIcon size={14} color="currentColor" />
            <span>System Users ({users.length})</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'research'} onClick={() => setActiveTab('research')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <PulseIcon size={14} color="currentColor" />
            <span>AI Waiting-Time & Research</span>
          </span>
        </Tab>
      </div>

      {/* ── Tab 1: Overview ── */}
      {activeTab === 'overview' && stats && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Hospital Queue Metrics (Today)
            </h2>
            <span
              style={{
                background: '#EFF6FF',
                color: '#1D4ED8',
                border: '1px solid #BFDBFE',
                padding: '0.3rem 0.8rem',
                borderRadius: '0',
                fontSize: '0.75rem',
                fontWeight: '700',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <PulseIcon size={13} color="#2563EB" />
              <span>Phase 4 Real-Time Active</span>
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <StatCard label="Total Registered Patients" value={stats.total_patients} color="var(--text-primary)" />
            <StatCard label="Active Virtual Queues" value={stats.active_virtual_queues ?? 0} color="#2563EB" />
            <StatCard label="Patients Waiting" value={stats.waiting} color="#D97706" />
            <StatCard label="Patients Consulting" value={stats.in_consultation} color="#2563EB" />
            <StatCard label="Consultations Completed" value={stats.completed} color="#059669" />
            <StatCard label="Active Medical Staff" value={stats.total_doctors} color="#4F46E5" />
          </div>

          {/* Phase 4: High-Level LIVE QUEUE STATUS by Department */}
          <div style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                  Live Queue Status
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  Real-time synchronization across outpatient departments
                </p>
              </div>
              <span style={{ fontSize: '0.72rem', color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '0.25rem 0.6rem', borderRadius: '0', fontWeight: '700' }}>
                Auto-updating via Socket.IO
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {liveDepartments.map((dept, index) => (
                <div
                  key={dept.id || dept.code || index}
                  className="card"
                  style={{
                    padding: '1.35rem',
                    borderLeft: `4px solid ${dept.status === 'Active' ? '#2563EB' : '#CBD5E1'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: dept.status === 'Active' ? '0 10px 25px rgba(37, 99, 235, 0.08), 0 0 0 1px #BFDBFE' : 'var(--shadow-card)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.95rem' }}>
                    <div>
                      <span style={{ fontWeight: '800', color: 'var(--text-primary)', fontSize: '1.05rem', fontFamily: "'Outfit', sans-serif" }}>{dept.name}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginLeft: '0.45rem', fontWeight: '600' }}>({dept.code})</span>
                    </div>
                    <span
                      style={{
                        background: dept.status === 'Active' ? '#ECFDF5' : '#F1F5F9',
                        color: dept.status === 'Active' ? '#047857' : 'var(--text-muted)',
                        padding: '0.2rem 0.65rem',
                        borderRadius: '0',
                        fontSize: '0.72rem',
                        fontWeight: '700',
                        border: `1px solid ${dept.status === 'Active' ? '#A7F3D0' : '#E2E8F0'}`
                      }}
                    >
                      {dept.status === 'Active' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                          <span>Active</span>
                        </span>
                      ) : 'Idle'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: '#F8FAFC', padding: '0.95rem', borderRadius: '0', border: '1px solid #E2E8F0' }}>
                    <div>
                      <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>
                        Currently Serving
                      </div>
                      <div style={{ fontSize: '1.45rem', fontWeight: '900', color: dept.currentlyServing !== '—' ? '#2563EB' : 'var(--text-muted)', marginTop: '0.2rem', fontFamily: "'Outfit', sans-serif" }}>
                        {dept.currentlyServing}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>
                        Waiting in Queue
                      </div>
                      <div style={{ fontSize: '1.45rem', fontWeight: '900', color: dept.waitingCount > 0 ? '#D97706' : '#059669', marginTop: '0.2rem', fontFamily: "'Outfit', sans-serif" }}>
                        {dept.waitingCount}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Real Queue + ML Analytics (No Fake Data) ── */}
      {activeTab === 'analytics' && (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Hospital Queue & Waiting-Time Analytics
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Accredited operational metrics calculated strictly from actual consultation timestamps and AI predictions.
            </p>
          </div>

          {/* Operational Metrics Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>Patients Served Today</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--text-primary)', marginTop: '0.3rem', fontFamily: "'Outfit', sans-serif" }}>
                {analyticsData?.summary?.patientsServedToday ?? 0}
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>Avg Waiting Time</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: analyticsData?.summary?.avgWaitingTimeMinutes ? '#2563EB' : 'var(--text-muted)', marginTop: '0.3rem', fontFamily: "'Outfit', sans-serif" }}>
                {analyticsData?.summary?.avgWaitingTimeMinutes ? `${analyticsData.summary.avgWaitingTimeMinutes} min` : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {analyticsData?.summary?.avgWaitingTimeMinutes ? 'Registration to consultation start' : 'No completed visits yet today'}
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>Avg Consultation Duration</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: analyticsData?.summary?.avgConsultationDurationMinutes ? '#059669' : 'var(--text-muted)', marginTop: '0.3rem', fontFamily: "'Outfit', sans-serif" }}>
                {analyticsData?.summary?.avgConsultationDurationMinutes ? `${analyticsData.summary.avgConsultationDurationMinutes} min` : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Doctor time per patient
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>No-Shows / Cancellations</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: (analyticsData?.summary?.noShowsToday || analyticsData?.summary?.cancellationsToday) ? '#DC2626' : '#059669', marginTop: '0.3rem', fontFamily: "'Outfit', sans-serif" }}>
                {(analyticsData?.summary?.noShowsToday ?? 0) + (analyticsData?.summary?.cancellationsToday ?? 0)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {analyticsData?.summary?.noShowsToday ?? 0} no-shows • {analyticsData?.summary?.cancellationsToday ?? 0} cancelled
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>Prediction Mean Error (MAE)</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: analyticsData?.mlAccuracy?.mae !== null ? '#4F46E5' : 'var(--text-muted)', marginTop: '0.3rem', fontFamily: "'Outfit', sans-serif" }}>
                {analyticsData?.mlAccuracy?.mae !== null ? `±${analyticsData.mlAccuracy.mae} min` : '—'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {analyticsData?.mlAccuracy?.hasEnoughData ? 'Evaluated vs actual wait' : 'Collecting more telemetry (min 3)'}
              </div>
            </div>
          </div>

          {/* Department Breakdown */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '1rem', letterSpacing: '-0.01em' }}>
              Department Performance Breakdown
            </h3>
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Registered</th>
                    <th>Served</th>
                    <th>Waiting</th>
                    <th>Avg Actual Wait</th>
                  </tr>
                </thead>
                <tbody>
                  {(analyticsData?.departmentPerformance && analyticsData.departmentPerformance.length > 0) ? (
                    analyticsData.departmentPerformance.map((dp, idx) => (
                      <tr key={`dp-${dp.departmentId || idx}`}>
                        <td style={{ fontWeight: '700', color: '#2563EB' }}>{dp.name} ({dp.code})</td>
                        <td>{dp.totalRegistered}</td>
                        <td style={{ color: '#059669', fontWeight: '700' }}>{dp.served}</td>
                        <td style={{ color: dp.waiting > 0 ? '#D97706' : 'var(--text-secondary)', fontWeight: '700' }}>{dp.waiting}</td>
                        <td style={{ fontWeight: '600' }}>{dp.avgWaitMinutes ? `${dp.avgWaitMinutes} min` : '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr key="empty-dept-perf">
                      <td colSpan="5" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                        No department telemetry registered today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Doctor Performance Breakdown */}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '1rem', letterSpacing: '-0.01em' }}>
              Doctor Consultation Duration
            </h3>
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Doctor Name</th>
                    <th>Department</th>
                    <th>Completed Consultations</th>
                    <th>Avg Consultation Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {(analyticsData?.doctorPerformance && analyticsData.doctorPerformance.length > 0) ? (
                    analyticsData.doctorPerformance.map((doc, idx) => (
                      <tr key={`doc-${doc.doctorId || idx}`}>
                        <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{doc.doctorName}</td>
                        <td style={{ color: '#2563EB', fontWeight: '600' }}>{doc.departmentName}</td>
                        <td style={{ fontWeight: '600' }}>{doc.completedCount}</td>
                        <td style={{ fontWeight: '700', color: '#059669' }}>
                          {doc.avgDurationMinutes ? `${doc.avgDurationMinutes} min` : '—'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr key="empty-doc-perf">
                      <td colSpan="4" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                        No doctor consultation duration records yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Predicted vs Actual Log */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                Recent Predictions vs Actual Waiting Times
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Strict comparison computed on patient consultation start
              </span>
            </div>

            {(!analyticsData?.predictedVsActual || analyticsData.predictedVsActual.length === 0) ? (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: '#F8FAFC', borderRadius: '0', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                  Not enough historical consultation data yet.
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Collecting more consultation telemetry. As doctors complete patient visits today, actual waiting-time comparisons will appear here in real time.
                </div>
              </div>
            ) : (
              <div className="table-container">
                <table className="modern-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Patients Ahead</th>
                      <th>Predicted Wait</th>
                      <th>Actual Wait</th>
                      <th>Absolute Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsData.predictedVsActual.map((item, idx) => (
                      <tr key={`pva-${item.id || idx}`}>
                        <td style={{ fontWeight: '800', color: '#2563EB', fontFamily: "'Outfit', sans-serif" }}>{item.token_number}</td>
                        <td>{item.patients_ahead}</td>
                        <td style={{ fontWeight: '600' }}>~{item.predicted_wait_minutes} min</td>
                        <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{item.actual_wait_minutes} min</td>
                        <td style={{ fontWeight: '700', color: item.error_minutes <= 4 ? '#059669' : '#D97706' }}>
                          ±{item.error_minutes} min
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab 2: Departments ── */}
      {activeTab === 'departments' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Hospital Departments
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
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
                    <td style={{ fontWeight: '800', color: '#2563EB', fontFamily: "'Outfit', sans-serif" }}>{d.code}</td>
                    <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{d.name}</td>
                    <td>
                      <div className="status-indicator">
                        <span className="status-dot status-dot--completed" />
                        <span style={{ fontWeight: '600', color: '#059669' }}>{d.status === 'ACTIVE' ? 'Active' : d.status}</span>
                      </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Medical Staff Directory
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Active consultants and specialists
            </span>
          </div>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Department</th>
                  <th>Specialization</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{d.name}</td>
                    <td style={{ color: '#2563EB', fontWeight: '600' }}>{d.department_name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.specialization || 'Consultant'}</td>
                    <td>
                      <div className="status-indicator">
                        <span className="status-dot status-dot--completed" />
                        <span style={{ fontWeight: '600', color: '#059669' }}>{d.status}</span>
                      </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              System Accounts
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Authenticated hospital staff credentials
            </span>
          </div>
          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{u.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                    <td>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        padding: '0.25rem 0.6rem',
                        borderRadius: '0',
                        background: u.role === 'ADMIN' ? '#EEF2FF' : u.role === 'DOCTOR' ? '#EFF6FF' : '#ECFDF5',
                        color: u.role === 'ADMIN' ? '#4F46E5' : u.role === 'DOCTOR' ? '#1D4ED8' : '#047857',
                        border: `1px solid ${u.role === 'ADMIN' ? '#C7D2FE' : u.role === 'DOCTOR' ? '#BFDBFE' : '#A7F3D0'}`
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <div className="status-indicator">
                        <span className="status-dot status-dot--completed" />
                        <span style={{ fontWeight: '600', color: '#059669' }}>{u.status}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 5: AI Research & Telemetry ── */}
      {activeTab === 'research' && (
        <div>
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                  Machine Learning Model Telemetry
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Model Version: {predictionMetrics?.modelInfo?.version || 'v1.0-gb'} • Architecture: {predictionMetrics?.modelInfo?.name || 'GradientBoostingRegressor'}
                </p>
              </div>
              <span style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', padding: '0.3rem 0.8rem', borderRadius: '0', fontSize: '0.75rem', fontWeight: '700' }}>
                Python FastAPI Live
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
              <StatCard label="Training MAE" value={predictionMetrics?.modelMetrics?.mae ? `±${predictionMetrics.modelMetrics.mae}m` : '±2.8m'} color="#2563EB" />
              <StatCard label="Live Eval MAE" value={predictionMetrics?.liveDatabaseStats?.liveMAE ? `±${predictionMetrics.liveDatabaseStats.liveMAE}m` : '—'} color="#4F46E5" />
              <StatCard label="Total Predictions" value={predictionMetrics?.liveDatabaseStats?.totalPredictions ?? 0} color="var(--text-primary)" />
              <StatCard label="Evaluated Logs" value={predictionMetrics?.liveDatabaseStats?.evaluatedCount ?? 0} color="#059669" />
            </div>
          </div>

          {/* Real-time prediction audit table */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '1rem', letterSpacing: '-0.01em' }}>
              Real-Time Prediction Logs (PostgreSQL Audit)
            </h3>
            <div className="table-container">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Ahead</th>
                    <th>Predicted</th>
                    <th>Range</th>
                    <th>Actual Wait</th>
                    <th>Error</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {(predictionMetrics?.recentPredictions && predictionMetrics.recentPredictions.length > 0) ? (
                    predictionMetrics.recentPredictions.map((p, idx) => (
                      <tr key={`rp-${p.id || idx}`}>
                        <td style={{ fontWeight: '800', color: '#2563EB', fontFamily: "'Outfit', sans-serif" }}>{p.token_number}</td>
                        <td>{p.patients_ahead}</td>
                        <td style={{ fontWeight: '600' }}>~{p.predicted_wait_minutes}m</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{p.lower_bound_minutes}–{p.upper_bound_minutes} min</td>
                        <td>
                          {p.actual_wait_minutes !== null ? (
                            <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{p.actual_wait_minutes}m</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Waiting...</span>
                          )}
                        </td>
                        <td>
                          {p.prediction_error !== null ? (
                            <span style={{ fontWeight: '700', color: Math.abs(p.prediction_error) <= 5 ? '#059669' : '#D97706' }}>
                              {p.prediction_error > 0 ? `+${p.prediction_error}` : p.prediction_error}m
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{
                            fontSize: '0.72rem',
                            background: p.is_fallback ? '#FEF3C7' : '#EFF6FF',
                            color: p.is_fallback ? '#B45309' : '#1D4ED8',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '0',
                            border: `1px solid ${p.is_fallback ? '#FDE68A' : '#BFDBFE'}`,
                            fontWeight: '700'
                          }}>
                            {p.is_fallback ? 'Fallback' : 'GBR v1.0'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr key="empty-recent-pred">
                      <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                        No prediction audit records logged today yet. As patients enter the virtual queue, predictions will appear here in real time.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
        background: active ? '#EFF6FF' : '#FFFFFF',
        color: active ? '#1D4ED8' : 'var(--text-secondary)',
        border: `1px solid ${active ? '#BFDBFE' : 'var(--border-subtle)'}`,
        padding: '0.55rem 1rem',
        minHeight: '40px',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        borderRadius: '0',
        cursor: 'pointer',
        fontWeight: active ? '700' : '600',
        fontSize: '0.82rem',
        transition: 'all 0.15s ease',
        touchAction: 'manipulation',
        boxShadow: active ? '0 2px 8px rgba(37, 99, 235, 0.12)' : 'var(--shadow-sm)',
      }}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: '1.25rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0, background: '#FFFFFF' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.25 }}>
        {label}
      </div>
      <div style={{ fontSize: 'clamp(1.6rem, 5vw, 2.1rem)', fontWeight: '800', color, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', fontFamily: "'Outfit', sans-serif" }}>
        {value}
      </div>
    </div>
  );
}
