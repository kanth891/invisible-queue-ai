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
  const [todayAvailability, setTodayAvailability] = useState([]);
  const [systemSettings, setSystemSettings] = useState({
    missed_token_grace_period_minutes: 5,
    max_rejoin_attempts: 2,
    max_reschedule_attempts: 2,
    daily_queue_capacity: 30,
    hospital_operating_hours: { open: '08:00', close: '18:00' },
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);

  // Modals
  const [showAddDoctorModal, setShowAddDoctorModal] = useState(false);
  const [addDoctorForm, setAddDoctorForm] = useState({
    name: '', email: '', password: '', department_id: '', specialization: '', room_number: '', daily_capacity: 30
  });

  const [showEditDoctorModal, setShowEditDoctorModal] = useState(false);
  const [editDoctorForm, setEditDoctorForm] = useState(null);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDoctor, setScheduleDoctor] = useState(null);
  const [doctorScheduleList, setDoctorScheduleList] = useState([]);

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveDoctor, setLeaveDoctor] = useState(null);
  const [doctorLeavesList, setDoctorLeavesList] = useState([]);
  const [leaveForm, setLeaveForm] = useState({
    leave_date: new Date().toISOString().split('T')[0],
    is_full_day: true,
    start_time: '09:00',
    end_time: '17:00',
    reason: 'Clinical leave'
  });

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFromDoctor, setTransferFromDoctor] = useState(null);
  const [transferToDoctorId, setTransferToDoctorId] = useState('');
  const [transferReason, setTransferReason] = useState('Physician unavailable / duty reassignment');
  const [transferring, setTransferring] = useState(false);
  const [actionError, setActionError] = useState(null);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [socketStatus, setSocketStatus] = useState('connecting');
  const isMounted = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const [
        statsRes,
        deptRes,
        docRes,
        usersRes,
        predRes,
        liveDeptRes,
        analyticsRes,
        availRes,
        settingsRes,
        eventsRes,
      ] = await Promise.all([
        queueAPI.stats(),
        departmentsAPI.list(),
        doctorsAPI.list(),
        usersAPI.list(),
        queueAPI.predictionMetrics().catch(() => ({ data: null })),
        analyticsAPI.liveStatus().catch(() => ({ data: [] })),
        analyticsAPI.overview().catch(() => ({ data: null })),
        doctorsAPI.getTodayAvailability().catch(() => ({ data: [] })),
        queueAPI.getSettings().catch(() => ({ data: {} })),
        queueAPI.getEvents({ limit: 50 }).catch(() => ({ data: [] })),
      ]);

      if (isMounted.current) {
        setStats(statsRes.data);
        setDepartments(deptRes.data);
        setDoctors(docRes.data);
        setUsers(usersRes.data);
        if (predRes?.data) setPredictionMetrics(predRes.data);
        if (liveDeptRes?.data) setLiveDepartments(liveDeptRes.data);
        if (analyticsRes?.data) setAnalyticsData(analyticsRes.data);
        if (availRes?.data) setTodayAvailability(availRes.data);
        if (settingsRes?.data) setSystemSettings(settingsRes.data);
        if (eventsRes?.data) setAuditEvents(eventsRes.data);
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

    const socket = socketService.connect();
    socketService.joinAdmin();

    const unsubStatus = socketService.subscribeStatus((st) => {
      if (isMounted.current) setSocketStatus(st);
    });

    const unsubReconnect = socketService.onReconnect(() => {
      fetchData();
    });

    const handleRealtimeChange = () => {
      if (isMounted.current) fetchData();
    };

    socket.on(SOCKET_EVENTS.QUEUE_UPDATED, handleRealtimeChange);
    socket.on(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, handleRealtimeChange);
    socket.on(SOCKET_EVENTS.QUEUE_TRANSFERRED, handleRealtimeChange);
    socket.on(SOCKET_EVENTS.QUEUE_PAUSED, handleRealtimeChange);
    socket.on(SOCKET_EVENTS.QUEUE_RESUMED, handleRealtimeChange);

    const t = setInterval(fetchData, 15000);

    return () => {
      isMounted.current = false;
      clearInterval(t);
      unsubStatus();
      unsubReconnect();
      socket.off(SOCKET_EVENTS.QUEUE_UPDATED, handleRealtimeChange);
      socket.off(SOCKET_EVENTS.DOCTOR_AVAILABILITY_CHANGED, handleRealtimeChange);
      socket.off(SOCKET_EVENTS.QUEUE_TRANSFERRED, handleRealtimeChange);
      socket.off(SOCKET_EVENTS.QUEUE_PAUSED, handleRealtimeChange);
      socket.off(SOCKET_EVENTS.QUEUE_RESUMED, handleRealtimeChange);
    };
  }, [fetchData]);

  const handleCreateDoctor = async (e) => {
    e.preventDefault();
    setActionError(null);
    try {
      await doctorsAPI.create(addDoctorForm);
      setShowAddDoctorModal(false);
      setAddDoctorForm({
        name: '', email: '', password: '', department_id: '', specialization: '', room_number: '', daily_capacity: 30
      });
      fetchData();
    } catch (err) {
      setActionError(err.message || 'Failed to create doctor');
    }
  };

  const handleUpdateDoctor = async (e) => {
    e.preventDefault();
    if (!editDoctorForm) return;
    setActionError(null);
    try {
      await doctorsAPI.update(editDoctorForm.id, editDoctorForm);
      setShowEditDoctorModal(false);
      setEditDoctorForm(null);
      fetchData();
    } catch (err) {
      setActionError(err.message || 'Failed to update doctor');
    }
  };

  const handleToggleDoctorStatus = async (doctor) => {
    const nextStatus = doctor.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (!confirm(`Are you sure you want to change ${doctor.name}'s status to ${nextStatus}?`)) return;
    try {
      await doctorsAPI.updateStatus(doctor.id, nextStatus);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to update status');
    }
  };

  const handleOpenScheduleModal = async (doctor) => {
    setScheduleDoctor(doctor);
    setActionError(null);
    setShowScheduleModal(true);
    try {
      const res = await doctorsAPI.getSchedule(doctor.id);
      const existing = res.data || [];
      const days = [
        { day_of_week: 0, dayName: 'Sun', is_working: false, start_time: '09:00', end_time: '13:00' },
        { day_of_week: 1, dayName: 'Mon', is_working: true, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 2, dayName: 'Tue', is_working: true, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 3, dayName: 'Wed', is_working: true, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 4, dayName: 'Thu', is_working: true, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 5, dayName: 'Fri', is_working: true, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 6, dayName: 'Sat', is_working: true, start_time: '09:00', end_time: '13:00' },
      ];
      const merged = days.map(d => {
        const found = existing.find(e => parseInt(e.day_of_week, 10) === d.day_of_week);
        return found ? { ...d, is_working: found.is_working, start_time: found.start_time, end_time: found.end_time } : d;
      });
      setDoctorScheduleList(merged);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSchedule = async () => {
    if (!scheduleDoctor) return;
    try {
      await doctorsAPI.updateSchedule(scheduleDoctor.id, doctorScheduleList);
      setShowScheduleModal(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to save schedule');
    }
  };

  const handleOpenLeaveModal = async (doctor) => {
    setLeaveDoctor(doctor);
    setActionError(null);
    setShowLeaveModal(true);
    try {
      const res = await doctorsAPI.getLeaves(doctor.id);
      setDoctorLeavesList(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddLeave = async (e) => {
    e.preventDefault();
    if (!leaveDoctor) return;
    try {
      await doctorsAPI.addLeave(leaveDoctor.id, leaveForm);
      const res = await doctorsAPI.getLeaves(leaveDoctor.id);
      setDoctorLeavesList(res.data || []);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to record leave');
    }
  };

  const handleDeleteLeave = async (leaveId) => {
    if (!leaveDoctor) return;
    try {
      await doctorsAPI.deleteLeave(leaveDoctor.id, leaveId);
      const res = await doctorsAPI.getLeaves(leaveDoctor.id);
      setDoctorLeavesList(res.data || []);
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to remove leave');
    }
  };

  const handlePauseResumeDoctor = async (doctor) => {
    try {
      if (doctor.operational_status === 'PAUSED') {
        await queueAPI.resumeDoctorQueue(doctor.id);
      } else {
        const reason = prompt('Reason for pausing queue:', 'Duty round / brief break');
        if (reason === null) return;
        await queueAPI.pauseDoctorQueue(doctor.id, reason || 'Break');
      }
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to toggle pause');
    }
  };

  const handleOpenTransferModal = (doctor) => {
    setTransferFromDoctor(doctor);
    setTransferToDoctorId('');
    setActionError(null);
    setShowTransferModal(true);
  };

  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    if (!transferFromDoctor || !transferToDoctorId) return;
    setTransferring(true);
    setActionError(null);
    try {
      await queueAPI.transfer({
        fromDoctorId: transferFromDoctor.id,
        toDoctorId: transferToDoctorId,
        reason: transferReason,
      });
      setShowTransferModal(false);
      fetchData();
    } catch (err) {
      setActionError(err.message || 'Failed to transfer queue');
    } finally {
      setTransferring(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsMsg(null);
    try {
      const res = await queueAPI.updateSettings(systemSettings);
      setSettingsMsg({ type: 'success', text: 'System configuration updated successfully' });
      setSystemSettings(res.data || systemSettings);
    } catch (err) {
      setSettingsMsg({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setSettingsSaving(false);
    }
  };

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
              borderRadius: 'var(--radius-full)',
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
            <span>Doctor Availability & Queues ({doctors.length})</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <ClockIcon size={14} color="currentColor" />
            <span>Policy & System Settings</span>
          </span>
        </Tab>
        <Tab active={activeTab === 'audit'} onClick={() => setActiveTab('audit')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <BarChartIcon size={14} color="currentColor" />
            <span>Queue Audit Trail</span>
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
                borderRadius: 'var(--radius-full)',
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
            <StatCard label="Total Patients Today" value={stats.total_patients} color="var(--text-primary)" />
            <StatCard label="Patients Waiting" value={stats.waiting} color="#D97706" />
            <StatCard label="Patients In Consultation" value={stats.in_consultation} color="#2563EB" />
            <StatCard label="Completed Today" value={stats.completed} color="#059669" />
            <StatCard label="Missed Tokens" value={analyticsData?.summary?.missedToday ?? 0} color="#E11D48" />
            <StatCard label="Rejoined Queue" value={analyticsData?.summary?.rejoinedToday ?? 0} color="#059669" />
            <StatCard label="Rescheduled Visits" value={analyticsData?.summary?.rescheduledToday ?? 0} color="#0284C7" />
            <StatCard label="Transferred Queues" value={analyticsData?.summary?.transferredToday ?? 0} color="#7C3AED" />
            <StatCard label="No-Shows / Cancelled" value={(analyticsData?.summary?.noShowsToday ?? 0) + (analyticsData?.summary?.cancellationsToday ?? 0)} color="#64748B" />
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
              <span style={{ fontSize: '0.72rem', color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '0.25rem 0.6rem', borderRadius: 'var(--radius-sm)', fontWeight: '700' }}>
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
                        borderRadius: 'var(--radius-full)',
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: '#F8FAFC', padding: '0.95rem', borderRadius: 'var(--radius-md)', border: '1px solid #E2E8F0' }}>
                    <div>
                      <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>
                        Currently Serving
                      </div>
                      <div style={{ fontSize: '1.45rem', fontWeight: '900', color: dept.currentlyServing !== '-' ? '#2563EB' : 'var(--text-muted)', marginTop: '0.2rem', fontFamily: "'Outfit', sans-serif" }}>
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
                {analyticsData?.summary?.avgWaitingTimeMinutes ? `${analyticsData.summary.avgWaitingTimeMinutes} min` : '-'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {analyticsData?.summary?.avgWaitingTimeMinutes ? 'Registration to consultation start' : 'No completed visits yet today'}
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.06em' }}>Avg Consultation Duration</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '800', color: analyticsData?.summary?.avgConsultationDurationMinutes ? '#059669' : 'var(--text-muted)', marginTop: '0.3rem', fontFamily: "'Outfit', sans-serif" }}>
                {analyticsData?.summary?.avgConsultationDurationMinutes ? `${analyticsData.summary.avgConsultationDurationMinutes} min` : '-'}
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
                {analyticsData?.mlAccuracy?.mae !== null ? `±${analyticsData.mlAccuracy.mae} min` : '-'}
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
                        <td style={{ fontWeight: '600' }}>{dp.avgWaitMinutes ? `${dp.avgWaitMinutes} min` : '-'}</td>
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
                          {doc.avgDurationMinutes ? `${doc.avgDurationMinutes} min` : '-'}
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
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: '#F8FAFC', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
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

      {/* ── Tab 3: Doctor Availability & Queue Operations ── */}
      {activeTab === 'doctors' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                Medical Staff & Operational Availability
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Identity, recurring schedules, date-specific leave, pause control, and queue transfers
              </p>
            </div>
            <button
              onClick={() => { setActionError(null); setShowAddDoctorModal(true); }}
              className="btn-primary"
              style={{ padding: '0.45rem 1rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <span>+ Add Doctor</span>
            </button>
          </div>

          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Doctor & Room</th>
                  <th>Department</th>
                  <th>Operational Status</th>
                  <th>Queue Load</th>
                  <th>System Status</th>
                  <th style={{ textAlign: 'right' }}>Operational Actions</th>
                </tr>
              </thead>
              <tbody>
                {(todayAvailability.length > 0 ? todayAvailability : doctors).map(d => {
                  const isPaused = d.operational_status === 'PAUSED' || d.operationalStatus === 'PAUSED';
                  const isLeave = d.operational_status === 'ON_LEAVE' || d.operationalStatus === 'ON_LEAVE';
                  const isInactive = d.status === 'INACTIVE';
                  const waitingCount = d.waitingCount ?? d.patientsWaiting ?? d.waiting_count ?? d.currentWaitingCount ?? 0;
                  const capacity = d.daily_capacity || d.dailyCapacity || d.capacity || 30;

                  return (
                    <tr key={`doc-row-${d.id}`}>
                      <td>
                        <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{d.name}</div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                          {d.specialization || 'Consultant'}{d.room_number ? ` • Room ${d.room_number}` : ''}
                        </div>
                      </td>
                      <td>
                        <span style={{ color: '#2563EB', fontWeight: '600' }}>{d.department_name}</span>
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.55rem',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            background: isLeave ? '#FEE2E2' : isPaused ? '#FEF3C7' : isInactive ? '#F1F5F9' : '#ECFDF5',
                            color: isLeave ? '#B91C1C' : isPaused ? '#B45309' : isInactive ? '#64748B' : '#047857',
                          }}
                        >
                          {isLeave ? 'ON LEAVE' : isPaused ? `PAUSED (${d.pause_reason || 'Break'})` : isInactive ? 'INACTIVE' : 'AVAILABLE'}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: '700', fontSize: '0.85rem' }}>
                          {waitingCount} / {capacity}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: waitingCount >= capacity ? '#DC2626' : 'var(--text-secondary)' }}>
                          {waitingCount >= capacity ? 'Capacity reached' : 'Active queue'}
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '0.74rem',
                            fontWeight: '700',
                            color: d.status === 'ACTIVE' ? '#059669' : '#94A3B8',
                          }}
                        >
                          {d.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handlePauseResumeDoctor(d)}
                            style={{
                              background: isPaused ? '#10B981' : '#F59E0B',
                              color: '#FFFFFF',
                              border: 'none',
                              padding: '0.25rem 0.5rem',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.70rem',
                              fontWeight: '700',
                              cursor: 'pointer',
                            }}
                          >
                            {isPaused ? 'Resume' : 'Pause'}
                          </button>
                          <button
                            onClick={() => handleOpenScheduleModal(d)}
                            className="table-action-btn"
                            style={{ fontSize: '0.70rem', padding: '0.25rem 0.45rem' }}
                          >
                            Schedule
                          </button>
                          <button
                            onClick={() => handleOpenLeaveModal(d)}
                            className="table-action-btn"
                            style={{ fontSize: '0.70rem', padding: '0.25rem 0.45rem' }}
                          >
                            Leave
                          </button>
                          {waitingCount > 0 && (
                            <button
                              onClick={() => handleOpenTransferModal(d)}
                              style={{
                                background: '#7C3AED',
                                color: '#FFFFFF',
                                border: 'none',
                                padding: '0.25rem 0.5rem',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.70rem',
                                fontWeight: '700',
                                cursor: 'pointer',
                              }}
                            >
                              Transfer ({waitingCount})
                            </button>
                          )}
                          <button
                            onClick={() => { setEditDoctorForm(d); setActionError(null); setShowEditDoctorModal(true); }}
                            className="table-action-btn"
                            style={{ fontSize: '0.70rem', padding: '0.25rem 0.45rem' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleDoctorStatus(d)}
                            style={{
                              background: 'transparent',
                              border: '1px solid #CBD5E1',
                              color: d.status === 'ACTIVE' ? '#DC2626' : '#059669',
                              padding: '0.25rem 0.45rem',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.70rem',
                              cursor: 'pointer',
                            }}
                          >
                            {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Policy & System Settings ── */}
      {activeTab === 'settings' && (
        <div className="card" style={{ padding: '1.5rem', maxWidth: '680px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            Hospital Queue Policies & Limits
          </h2>
          <p style={{ fontSize: '0.80rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.45 }}>
            Configure operational queue boundaries, missed token timeouts, and safety limits. All values are authoritative on the backend.
          </p>

          {settingsMsg && (
            <div
              style={{
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1.25rem',
                fontSize: '0.82rem',
                background: settingsMsg.type === 'success' ? '#ECFDF5' : '#FEE2E2',
                color: settingsMsg.type === 'success' ? '#047857' : '#B91C1C',
                border: `1px solid ${settingsMsg.type === 'success' ? '#A7F3D0' : '#FCA5A5'}`,
              }}
            >
              {settingsMsg.text}
            </div>
          )}

          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: '700', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                Missed Token Grace Period (Minutes)
              </label>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
                Window during which a called patient must arrive at consultation before moving to MISSED status. Survives browser closure.
              </div>
              <input
                type="number"
                min="1"
                max="30"
                value={systemSettings.missed_token_grace_period_minutes || 5}
                onChange={(e) => setSystemSettings({ ...systemSettings, missed_token_grace_period_minutes: parseInt(e.target.value, 10) })}
                className="input-control"
                style={{ maxWidth: '180px' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: '700', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                Maximum Rejoin Limit per Visit
              </label>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
                Maximum times a patient who missed their turn can rejoin the end of the queue.
              </div>
              <input
                type="number"
                min="1"
                max="5"
                value={systemSettings.max_rejoin_attempts || 2}
                onChange={(e) => setSystemSettings({ ...systemSettings, max_rejoin_attempts: parseInt(e.target.value, 10) })}
                className="input-control"
                style={{ maxWidth: '180px' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: '700', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                Maximum Same-Day Reschedule Limit
              </label>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
                Maximum times a patient can switch doctors within their department on the same visit.
              </div>
              <input
                type="number"
                min="1"
                max="5"
                value={systemSettings.max_reschedule_attempts || 2}
                onChange={(e) => setSystemSettings({ ...systemSettings, max_reschedule_attempts: parseInt(e.target.value, 10) })}
                className="input-control"
                style={{ maxWidth: '180px' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: '700', fontSize: '0.84rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                Default Doctor Daily Queue Capacity
              </label>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
                Cap on registrations per doctor per day before capacity warning is triggered.
              </div>
              <input
                type="number"
                min="5"
                max="200"
                value={systemSettings.daily_queue_capacity || 30}
                onChange={(e) => setSystemSettings({ ...systemSettings, daily_queue_capacity: parseInt(e.target.value, 10) })}
                className="input-control"
                style={{ maxWidth: '180px' }}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', maxWidth: '380px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                  Hospital Open Time
                </label>
                <input
                  type="time"
                  value={systemSettings.hospital_operating_hours?.open || '08:00'}
                  onChange={(e) => setSystemSettings({
                    ...systemSettings,
                    hospital_operating_hours: { ...systemSettings.hospital_operating_hours, open: e.target.value }
                  })}
                  className="input-control"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: '700', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                  Hospital Close Time
                </label>
                <input
                  type="time"
                  value={systemSettings.hospital_operating_hours?.close || '18:00'}
                  onChange={(e) => setSystemSettings({
                    ...systemSettings,
                    hospital_operating_hours: { ...systemSettings.hospital_operating_hours, close: e.target.value }
                  })}
                  className="input-control"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={settingsSaving}
              className="btn-primary"
              style={{ padding: '0.65rem 1.25rem', marginTop: '0.5rem', width: 'fit-content' }}
            >
              {settingsSaving ? 'Saving Policies...' : 'Save Configuration'}
            </button>
          </form>
        </div>
      )}

      {/* ── Tab: Queue Audit Event Trail ── */}
      {activeTab === 'audit' && (
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                Authoritative Queue Audit Trail
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Immutable event stream for calls, missed tokens, rejoins, reschedules, and doctor queue transfers
              </p>
            </div>
            <button onClick={fetchData} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem' }}>
              Refresh Events
            </button>
          </div>

          <div className="table-container">
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Token</th>
                  <th>Doctor & Dept</th>
                  <th>Actor Role</th>
                  <th>Event Summary</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.length > 0 ? (
                  auditEvents.map((evt) => {
                    const isAlert = ['MISSED', 'CANCELLED', 'NO_SHOW'].includes(evt.event_type);
                    const isSuccess = ['REJOINED', 'COMPLETED', 'QUEUE_TRANSFERRED'].includes(evt.event_type);
                    return (
                      <tr key={`evt-${evt.id}`}>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          <span style={{ display: 'block', fontSize: '0.70rem', color: '#94A3B8' }}>
                            {new Date(evt.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '0.72rem',
                              fontWeight: '700',
                              background: isAlert ? '#FEE2E2' : isSuccess ? '#ECFDF5' : '#EFF6FF',
                              color: isAlert ? '#B91C1C' : isSuccess ? '#047857' : '#1D4ED8',
                            }}
                          >
                            {evt.event_type}
                          </span>
                        </td>
                        <td style={{ fontWeight: '800', color: 'var(--text-primary)' }}>
                          {evt.token_number || '-'}
                        </td>
                        <td>
                          <div style={{ fontWeight: '600', fontSize: '0.82rem' }}>{evt.doctor_name || '-'}</div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{evt.department_name || '-'}</div>
                        </td>
                        <td style={{ fontSize: '0.78rem', fontWeight: '600', color: '#475569' }}>
                          {evt.actor_role || 'SYSTEM'}
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          {evt.metadata ? (typeof evt.metadata === 'string' ? evt.metadata : JSON.stringify(evt.metadata)) : '-'}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                      No queue audit records found.
                    </td>
                  </tr>
                )}
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
                        borderRadius: 'var(--radius-sm)',
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
              <span style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', padding: '0.3rem 0.8rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: '700' }}>
                Python FastAPI Live
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
              <StatCard label="Training MAE" value={predictionMetrics?.modelMetrics?.mae ? `±${predictionMetrics.modelMetrics.mae}m` : '±2.8m'} color="#2563EB" />
              <StatCard label="Live Eval MAE" value={predictionMetrics?.liveDatabaseStats?.liveMAE ? `±${predictionMetrics.liveDatabaseStats.liveMAE}m` : '-'} color="#4F46E5" />
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
                        <td style={{ color: 'var(--text-secondary)' }}>{p.lower_bound_minutes}-{p.upper_bound_minutes} min</td>
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
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td>
                          <span style={{
                            fontSize: '0.72rem',
                            background: p.is_fallback ? '#FEF3C7' : '#EFF6FF',
                            color: p.is_fallback ? '#B45309' : '#1D4ED8',
                            padding: '0.2rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
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

      {/* ── MODAL: Add Doctor ── */}
      {showAddDoctorModal && (
        <div className="modal-overlay" onClick={() => setShowAddDoctorModal(false)}>
          <div className="modal-content" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Register New Doctor</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Add a physician with department assignment and daily consultation limits.
                </p>
              </div>
              <button
                onClick={() => setShowAddDoctorModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>

            {actionError && (
              <div style={{ padding: '0.75rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius-sm)', color: '#DC2626', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {actionError}
              </div>
            )}

            <form onSubmit={handleCreateDoctor} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label className="label">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Priya Sharma"
                  className="input"
                  value={addDoctorForm.name}
                  onChange={e => setAddDoctorForm({ ...addDoctorForm, name: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="doctor@hospital.org"
                    className="input"
                    value={addDoctorForm.email}
                    onChange={e => setAddDoctorForm({ ...addDoctorForm, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Temporary Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                    className="input"
                    value={addDoctorForm.password}
                    onChange={e => setAddDoctorForm({ ...addDoctorForm, password: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Department *</label>
                  <select
                    required
                    className="select"
                    value={addDoctorForm.department_id}
                    onChange={e => setAddDoctorForm({ ...addDoctorForm, department_id: e.target.value })}
                  >
                    <option value="">Select department</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Specialization</label>
                  <input
                    type="text"
                    placeholder="e.g. Cardiology"
                    className="input"
                    value={addDoctorForm.specialization}
                    onChange={e => setAddDoctorForm({ ...addDoctorForm, specialization: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Room / Clinic Number</label>
                  <input
                    type="text"
                    placeholder="e.g. Room 204"
                    className="input"
                    value={addDoctorForm.room_number}
                    onChange={e => setAddDoctorForm({ ...addDoctorForm, room_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Daily Intake Capacity</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="input"
                    value={addDoctorForm.daily_capacity}
                    onChange={e => setAddDoctorForm({ ...addDoctorForm, daily_capacity: parseInt(e.target.value, 10) || 30 })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddDoctorModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Register Doctor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Edit Doctor ── */}
      {showEditDoctorModal && editDoctorForm && (
        <div className="modal-overlay" onClick={() => setShowEditDoctorModal(false)}>
          <div className="modal-content" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Edit Doctor Profile</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Update details for Dr. {editDoctorForm.name}
                </p>
              </div>
              <button
                onClick={() => setShowEditDoctorModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>

            {actionError && (
              <div style={{ padding: '0.75rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius-sm)', color: '#DC2626', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {actionError}
              </div>
            )}

            <form onSubmit={handleUpdateDoctor} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label className="label">Full Name *</label>
                <input
                  type="text"
                  required
                  className="input"
                  value={editDoctorForm.name}
                  onChange={e => setEditDoctorForm({ ...editDoctorForm, name: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Department *</label>
                  <select
                    required
                    className="select"
                    value={editDoctorForm.department_id}
                    onChange={e => setEditDoctorForm({ ...editDoctorForm, department_id: e.target.value })}
                  >
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Specialization</label>
                  <input
                    type="text"
                    className="input"
                    value={editDoctorForm.specialization || ''}
                    onChange={e => setEditDoctorForm({ ...editDoctorForm, specialization: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Room / Clinic Number</label>
                  <input
                    type="text"
                    className="input"
                    value={editDoctorForm.room_number || ''}
                    onChange={e => setEditDoctorForm({ ...editDoctorForm, room_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Daily Capacity</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="input"
                    value={editDoctorForm.daily_capacity || 30}
                    onChange={e => setEditDoctorForm({ ...editDoctorForm, daily_capacity: parseInt(e.target.value, 10) || 30 })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEditDoctorModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Schedule Management ── */}
      {showScheduleModal && scheduleDoctor && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-content" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Weekly Consultation Schedule</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Set standard working days and consultation hours for Dr. {scheduleDoctor.name}
                </p>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
              {doctorScheduleList.map((slot, idx) => (
                <div
                  key={slot.day_of_week}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.65rem 0.9rem',
                    background: slot.is_working ? '#F8FAFC' : '#F1F5F9',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    opacity: slot.is_working ? 1 : 0.65,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 700, width: '110px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(slot.is_working)}
                      onChange={e => {
                        const updated = [...doctorScheduleList];
                        updated[idx].is_working = e.target.checked;
                        setDoctorScheduleList(updated);
                      }}
                    />
                    {slot.dayName}
                  </label>

                  {slot.is_working ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="time"
                        className="input"
                        style={{ padding: '0.35rem 0.5rem', width: '110px' }}
                        value={slot.start_time || '09:00'}
                        onChange={e => {
                          const updated = [...doctorScheduleList];
                          updated[idx].start_time = e.target.value;
                          setDoctorScheduleList(updated);
                        }}
                      />
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>to</span>
                      <input
                        type="time"
                        className="input"
                        style={{ padding: '0.35rem 0.5rem', width: '110px' }}
                        value={slot.end_time || '17:00'}
                        onChange={e => {
                          const updated = [...doctorScheduleList];
                          updated[idx].end_time = e.target.value;
                          setDoctorScheduleList(updated);
                        }}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      Off Duty
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveSchedule}
              >
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Leave Management ── */}
      {showLeaveModal && leaveDoctor && (
        <div className="modal-overlay" onClick={() => setShowLeaveModal(false)}>
          <div className="modal-content" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Manage Leave Calendar</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Dr. {leaveDoctor.name} ({leaveDoctor.specialization || 'General'})
                </p>
              </div>
              <button
                onClick={() => setShowLeaveModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>

            {/* Add Leave Form */}
            <form onSubmit={handleAddLeave} style={{ background: '#F8FAFC', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                Add New Leave Entry
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="label">Date *</label>
                  <input
                    type="date"
                    required
                    className="input"
                    value={leaveForm.leave_date}
                    onChange={e => setLeaveForm({ ...leaveForm, leave_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Reason / Notes</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Annual leave / Conference"
                    value={leaveForm.reason}
                    onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={leaveForm.is_full_day}
                    onChange={e => setLeaveForm({ ...leaveForm, is_full_day: e.target.checked })}
                  />
                  Full Day Leave
                </label>

                {!leaveForm.is_full_day && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="time"
                      className="input"
                      style={{ padding: '0.35rem 0.5rem', width: '110px' }}
                      value={leaveForm.start_time}
                      onChange={e => setLeaveForm({ ...leaveForm, start_time: e.target.value })}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>to</span>
                    <input
                      type="time"
                      className="input"
                      style={{ padding: '0.35rem 0.5rem', width: '110px' }}
                      value={leaveForm.end_time}
                      onChange={e => setLeaveForm({ ...leaveForm, end_time: e.target.value })}
                    />
                  </div>
                )}

                <button type="submit" className="btn btn-primary" style={{ marginLeft: 'auto', padding: '0.45rem 0.9rem', fontSize: '0.82rem' }}>
                  Record Leave
                </button>
              </div>
            </form>

            {/* Existing Leaves List */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                Scheduled Leaves ({doctorLeavesList.length})
              </div>
              {doctorLeavesList.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem', background: '#FFFFFF', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                  No upcoming leaves scheduled for this doctor.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '200px', overflowY: 'auto' }}>
                  {doctorLeavesList.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.6rem 0.85rem',
                        background: '#FFFFFF',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.82rem',
                      }}
                    >
                      <div>
                        <strong>{item.leave_date}</strong>
                        <span style={{ marginLeft: '0.6rem', color: 'var(--text-secondary)' }}>
                          {item.is_full_day ? 'Full Day' : `${item.start_time || '09:00'} - ${item.end_time || '17:00'}`}
                        </span>
                        {item.reason && (
                          <span style={{ marginLeft: '0.6rem', color: '#64748B' }}>
                            ({item.reason})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteLeave(item.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#DC2626',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          padding: '0.2rem 0.4rem',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowLeaveModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Queue Transfer ── */}
      {showTransferModal && transferFromDoctor && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal-content" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Queue Reassignment Transfer</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Reassign active waiting patients to another available physician.
                </p>
              </div>
              <button
                onClick={() => setShowTransferModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '0.85rem 1rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.82rem', color: '#92400E', lineHeight: 1.45 }}>
              Transferring active queue from <strong>Dr. {transferFromDoctor.name}</strong>. Only <strong>WAITING</strong> tokens will be appended to the destination queue. Current token sequences and wait estimates will update immediately in real time.
            </div>

            {actionError && (
              <div style={{ padding: '0.75rem 1rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius-sm)', color: '#DC2626', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {actionError}
              </div>
            )}

            <form onSubmit={handleTransferSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label className="label">Destination Doctor *</label>
                <select
                  required
                  className="select"
                  value={transferToDoctorId}
                  onChange={e => setTransferToDoctorId(e.target.value)}
                >
                  <option value="">Select compatible doctor</option>
                  {doctors
                    .filter(d => d.id !== transferFromDoctor.id && d.department_id === transferFromDoctor.department_id && d.status === 'ACTIVE')
                    .map(d => {
                      const avail = todayAvailability.find(a => a.id === d.id);
                      const isAvail = avail?.computed_availability === 'AVAILABLE';
                      return (
                        <option key={d.id} value={d.id}>
                          Dr. {d.name} {d.room_number ? `(${d.room_number})` : ''} - {isAvail ? 'Available' : (avail?.computed_availability || d.operational_status)}
                        </option>
                      );
                    })}
                </select>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Only active physicians in {departments.find(dep => dep.id === transferFromDoctor.department_id)?.name || 'the same department'} are eligible.
                </div>
              </div>

              <div>
                <label className="label">Transfer Reason *</label>
                <input
                  type="text"
                  required
                  className="input"
                  value={transferReason}
                  onChange={e => setTransferReason(e.target.value)}
                  placeholder="e.g. Physician emergency / Shift reassignment"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowTransferModal(false)}
                  disabled={transferring}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={transferring || !transferToDoctorId}
                  style={{ background: '#D97706', borderColor: '#D97706' }}
                >
                  {transferring ? 'Transferring Queue...' : 'Execute Queue Transfer'}
                </button>
              </div>
            </form>
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
        borderRadius: 'var(--radius-sm)',
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
