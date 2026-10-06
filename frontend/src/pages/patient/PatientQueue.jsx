import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { queueAPI } from '../../services/api';
import socketService, { SOCKET_EVENTS } from '../../services/socket';
import { useNotifications } from '../../context/NotificationContext';
import { 
  MedicalCrossIcon, 
  SearchIcon, 
  StethoscopeIcon, 
  CheckCircleIcon, 
  ClockIcon, 
  PulseIcon, 
  AlertTriangleIcon, 
  XCircleIcon, 
  RefreshIcon, 
  BellIcon 
} from '../../components/Icons';

const FALLBACK_POLL_INTERVAL_MS = 15000;

export default function PatientQueue() {
  const { accessToken } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const { notify, browserPermission, requestBrowserPermission } = useNotifications();
  const isMounted = useRef(true);

  const fetchQueue = useCallback(async (isManual = false) => {
    if (!accessToken) return;
    if (isManual) setRefreshing(true);
    try {
      const res = await queueAPI.getByAccessToken(accessToken);
      if (isMounted.current) {
        setData(res.data);
        setError(null);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err.message || 'Unable to load queue information');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [accessToken]);

  // Real-Time Socket.IO Synchronization & Reconnect Handling
  useEffect(() => {
    isMounted.current = true;
    fetchQueue();

    // 1. Connect and join patient-specific secure room
    const socket = socketService.connect();
    socketService.joinPatient(accessToken);

    const unsubStatus = socketService.subscribeStatus((st) => {
      if (isMounted.current) setConnectionStatus(st);
    });

    // When socket reconnects after network drop, refetch authoritative REST state
    const unsubReconnect = socketService.onReconnect(() => {
      fetchQueue();
    });

    // 2. Real-time event listeners
    const handleWaitTimeUpdated = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, ...payload } : payload));
      setLastUpdated(new Date());
    };

    const handlePatientApproaching = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, isApproaching: true, patientsAhead: payload.patientsAhead } : prev));
      notify({
        type: 'APPROACHING',
        title: 'Turn Approaching',
        message: payload.message || `Your consultation is approaching (${payload.patientsAhead} ahead). Please make your way back.`,
        dedupeKey: `${accessToken}_APPROACHING`,
      });
      setLastUpdated(new Date());
    };

    const handlePatientTurn = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'CALLED', isApproaching: false, patientsAhead: 0, position: 1 } : prev));
      notify({
        type: 'TURN',
        title: "IT'S YOUR TURN",
        message: payload.message || 'Your token has been called! Please proceed to the consultation room.',
        dedupeKey: `${accessToken}_TURN`,
        duration: 0,
      });
      setLastUpdated(new Date());
    };

    const handleConsultationStarted = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'IN_CONSULTATION' } : prev));
      setLastUpdated(new Date());
    };

    const handleConsultationCompleted = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'COMPLETED' } : prev));
      setLastUpdated(new Date());
    };

    const handleNoShow = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'NO_SHOW' } : prev));
      setLastUpdated(new Date());
    };

    const handleCancelled = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'CANCELLED' } : prev));
      setLastUpdated(new Date());
    };

    socket.on(SOCKET_EVENTS.WAIT_TIME_UPDATED, handleWaitTimeUpdated);
    socket.on(SOCKET_EVENTS.PATIENT_APPROACHING, handlePatientApproaching);
    socket.on(SOCKET_EVENTS.PATIENT_TURN, handlePatientTurn);
    socket.on(SOCKET_EVENTS.CONSULTATION_STARTED, handleConsultationStarted);
    socket.on(SOCKET_EVENTS.CONSULTATION_COMPLETED, handleConsultationCompleted);
    socket.on(SOCKET_EVENTS.PATIENT_NO_SHOW, handleNoShow);
    socket.on(SOCKET_EVENTS.QUEUE_CANCELLED, handleCancelled);

    // 3. Fallback polling
    const pollInterval = setInterval(() => {
      fetchQueue();
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => {
      isMounted.current = false;
      clearInterval(pollInterval);
      unsubStatus();
      unsubReconnect();
      socketService.leavePatient(accessToken);
      socket.off(SOCKET_EVENTS.WAIT_TIME_UPDATED, handleWaitTimeUpdated);
      socket.off(SOCKET_EVENTS.PATIENT_APPROACHING, handlePatientApproaching);
      socket.off(SOCKET_EVENTS.PATIENT_TURN, handlePatientTurn);
      socket.off(SOCKET_EVENTS.CONSULTATION_STARTED, handleConsultationStarted);
      socket.off(SOCKET_EVENTS.CONSULTATION_COMPLETED, handleConsultationCompleted);
      socket.off(SOCKET_EVENTS.PATIENT_NO_SHOW, handleNoShow);
      socket.off(SOCKET_EVENTS.QUEUE_CANCELLED, handleCancelled);
    };
  }, [accessToken, fetchQueue, notify]);

  if (loading) {
    return (
      <div className="patient-queue-container" style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ width: '32px', height: '32px' }} />
        <div style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.90rem', fontWeight: '500' }}>
          Loading your virtual outpatient pass...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="patient-queue-container">
        <div
          className="card"
          style={{
            maxWidth: '420px',
            width: '100%',
            padding: '2rem',
            textAlign: 'center',
            border: '1px solid #FECACA',
            boxShadow: '0 20px 45px -10px rgba(15, 23, 42, 0.08)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.85rem' }}>
            <AlertTriangleIcon size={36} color="#DC2626" />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            Invalid or Expired Pass
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.5, marginBottom: '1.25rem' }}>
            {error}. If you just registered, please verify the token link or visit the outpatient reception desk.
          </p>
          <button
            onClick={() => fetchQueue(true)}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isApproaching = data.status === 'WAITING' && data.isApproaching;
  const isCalled = data.status === 'CALLED';
  const isConsulting = data.status === 'IN_CONSULTATION';
  const isCompleted = data.status === 'COMPLETED';

  return (
    <div className="patient-queue-container">
      {/* Hospital Brand Header with Live Status Indicator */}
      <div style={{ textAlign: 'center', marginBottom: '1.25rem', width: '100%', maxWidth: '420px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'var(--primary-gradient)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)'
            }}
          >
            <MedicalCrossIcon size={16} color="#FFFFFF" />
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: '800', letterSpacing: '-0.02em', color: '#0F172A' }}>
            Invisible Queue AI
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#64748B', letterSpacing: '0.02em', textTransform: 'uppercase', fontWeight: '600' }}>
          <span>Outpatient Digital Pass</span>
          <span>•</span>
          {connectionStatus === 'connected' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#059669', fontWeight: '700' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
              Live Sync
            </span>
          ) : connectionStatus === 'reconnecting' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#D97706', fontWeight: '700' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
              Reconnecting
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#64748B' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94A3B8', display: 'inline-block' }} />
              Offline
            </span>
          )}
        </div>
      </div>

      {/* Main Clinical Pass Card */}
      <div className="patient-pass-card">
        
        {/* Pass Header & Token Section */}
        <div className="patient-token-header">
          <div style={{ fontSize: '0.74rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '700' }}>
            Outpatient Token
          </div>
          <div className="patient-token-number">
            {data.token}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: '800', fontFamily: 'var(--font-heading)', color: 'var(--text-primary)', marginTop: '0.25rem', wordBreak: 'break-word' }}>
            {data.doctor}
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--primary-blue)', fontWeight: '600', marginTop: '0.15rem' }}>
            {data.department}
          </div>
        </div>

        {/* ── Clinical Alerts & Status (Bright Radiant Luxury Hierarchy) ── */}

        {/* 1. YOUR TURN (Called) - Prominent Notice */}
        {isCalled && (
          <div
            style={{
              background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
              border: '2px solid #2563EB',
              borderRadius: '12px',
              padding: '1.2rem 1rem',
              marginBottom: '1.35rem',
              textAlign: 'center',
              boxShadow: '0 8px 25px rgba(37, 99, 235, 0.2)',
              animation: 'pulseGlow 2s infinite ease-in-out',
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.2rem', fontWeight: '900', fontFamily: 'var(--font-heading)', color: '#1D4ED8', marginBottom: '0.35rem', letterSpacing: '0.01em' }}>
              <PulseIcon size={20} color="#2563EB" />
              <span>IT'S YOUR TURN NOW</span>
            </div>
            <div style={{ fontSize: '0.88rem', color: '#1E40AF', lineHeight: 1.45, fontWeight: '600' }}>
              Your token <strong>{data.token}</strong> has been called. Please proceed immediately to the consultation room.
            </div>
          </div>
        )}

        {/* 2. APPROACHING TURN - Clinical Pre-Warning */}
        {isApproaching && (
          <div
            style={{
              background: 'linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 100%)',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #D97706',
              borderRadius: '10px',
              padding: '0.95rem 1rem',
              marginBottom: '1.35rem',
              boxShadow: '0 4px 15px rgba(217, 119, 6, 0.12)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.90rem', fontWeight: '800', fontFamily: 'var(--font-heading)', color: '#92400E', marginBottom: '0.25rem' }}>
              <span className="status-dot status-dot--waiting" />
              <span>Your Turn is Approaching</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#78350F', lineHeight: 1.45 }}>
              Only <strong>{data.patientsAhead}</strong> patient{data.patientsAhead === 1 ? '' : 's'} ahead. Please start making your way back to the consultation area.
            </div>
          </div>
        )}

        {/* 3. In Consultation */}
        {isConsulting && (
          <div
            style={{
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: '10px',
              padding: '0.95rem 1rem',
              marginBottom: '1.35rem',
              textAlign: 'center',
              boxShadow: '0 4px 12px rgba(5, 150, 105, 0.08)'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.92rem', fontWeight: '800', fontFamily: 'var(--font-heading)', color: '#047857' }}>
              <StethoscopeIcon size={18} color="#047857" />
              <span>Consultation in Progress</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#065F46', marginTop: '0.2rem' }}>
              You are currently consulting with {data.doctor}.
            </div>
          </div>
        )}

        {/* 4. Consultation Completed */}
        {isCompleted && (
          <div
            style={{
              background: '#F1F5F9',
              border: '1px solid #E2E8F0',
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1.35rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.95rem', fontWeight: '800', fontFamily: 'var(--font-heading)', color: '#334155', marginBottom: '0.25rem' }}>
              <CheckCircleIcon size={18} color="#059669" />
              <span>Consultation Completed</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#475569' }}>
              Thank you for visiting today. Wishing you a swift recovery!
            </div>
          </div>
        )}

        {/* 5. Consultation Cancelled */}
        {data.status === 'CANCELLED' && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1.35rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.95rem', fontWeight: '800', color: '#B91C1C', marginBottom: '0.25rem' }}>
              <XCircleIcon size={18} color="#DC2626" />
              <span>Consultation Token Cancelled</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#991B1B', lineHeight: 1.45 }}>
              This token has been cancelled. If this was done in error or you need assistance, please speak with the outpatient reception desk.
            </div>
          </div>
        )}

        {/* 6. Marked as No-Show */}
        {data.status === 'NO_SHOW' && (
          <div
            style={{
              background: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #D97706',
              borderRadius: '10px',
              padding: '0.95rem 1rem',
              marginBottom: '1.35rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.90rem', fontWeight: '800', color: '#92400E', marginBottom: '0.25rem' }}>
              <AlertTriangleIcon size={18} color="#D97706" />
              <span>Marked as No-Show</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#78350F', lineHeight: 1.45 }}>
              You were not present when your token was called. Please check in with reception to rejoin the queue or receive a new token.
            </div>
          </div>
        )}

        {/* Normal Waiting Status (When not yet approaching) */}
        {data.status === 'WAITING' && !data.isApproaching && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.55rem 0.85rem',
              background: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              marginBottom: '1.35rem',
              fontSize: '0.84rem',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              textAlign: 'center'
            }}
          >
            <span className="status-dot status-dot--waiting" />
            <span>Waiting in Queue — Position #{data.position ?? 1}</span>
          </div>
        )}

        {/* ── Key Metrics Grid (Serving, Position, Ahead) ── */}
        <div className="patient-metrics-grid">
          {/* Currently Serving */}
          <div className="patient-metric-box">
            <div className="patient-metric-label">Serving</div>
            <div
              className="patient-metric-value"
              style={{ color: data.currentToken ? 'var(--primary-blue)' : 'var(--text-muted)' }}
            >
              {data.currentToken || '—'}
            </div>
          </div>

          {/* Your Position */}
          <div className="patient-metric-box">
            <div className="patient-metric-label">Position</div>
            <div
              className="patient-metric-value"
              style={{ color: data.position !== null ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              {data.position !== null ? `#${data.position}` : '—'}
            </div>
          </div>

          {/* Patients Ahead */}
          <div className="patient-metric-box">
            <div className="patient-metric-label">Ahead</div>
            <div
              className="patient-metric-value"
              style={{ color: data.patientsAhead > 0 ? '#D97706' : '#059669' }}
            >
              {data.patientsAhead !== null ? data.patientsAhead : '0'}
            </div>
          </div>
        </div>

        {/* Remote Freedom Notice */}
        {['WAITING', 'CALLED'].includes(data.status) && (
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '0.85rem 0.95rem',
              marginBottom: '1.35rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem'
            }}
          >
            <div style={{ marginTop: '0.2rem', flexShrink: 0 }}>
              <ClockIcon size={16} color="var(--primary-blue)" />
            </div>
            <div style={{ fontSize: '0.80rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Virtual Queue Active.</strong> You may relax in the cafeteria, outdoor courtyard, or lobby. This pass updates automatically in real-time.
            </div>
          </div>
        )}

        {/* Phase 4 Browser Notification Permission Banner (Opt-in only, no spam) */}
        {browserPermission === 'default' && ['WAITING', 'CALLED'].includes(data.status) && (
          <div
            style={{
              background: '#EFF6FF',
              border: '1px solid #BFDBFE',
              borderRadius: '10px',
              padding: '0.85rem 0.95rem',
              marginBottom: '1.35rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.65rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '0.80rem', color: '#1E40AF', flex: '1 1 200px', fontWeight: '500' }}>
              Want your device to ring when your turn approaches?
            </div>
            <button
              onClick={requestBrowserPermission}
              className="btn-primary"
              style={{
                padding: '0.40rem 0.75rem',
                fontSize: '0.76rem',
                minHeight: '34px',
                flexShrink: 0,
              }}
            >
              Enable Alerts
            </button>
          </div>
        )}

        {browserPermission === 'granted' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              marginBottom: '1.35rem',
              fontSize: '0.74rem',
              color: '#059669',
              fontWeight: '600',
            }}
          >
            <CheckCircleIcon size={14} color="#059669" />
            <span>Live device alerts enabled</span>
          </div>
        )}

        {/* Estimated Wait Time Box (Phase 3 & 4 AI Gradient Boosting / Fallback Range) */}
        {data.status === 'WAITING' && (
          <div
            style={{
              background: 'linear-gradient(135deg, #F0FDF4 0%, #EFF6FF 100%)',
              border: '1px solid #BFDBFE',
              borderRadius: '12px',
              padding: '1.1rem 1.15rem',
              marginBottom: '1.35rem',
              textAlign: 'center',
              boxShadow: '0 4px 16px rgba(37, 99, 235, 0.08)'
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#4338CA',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem'
              }}
            >
              <PulseIcon size={14} color="var(--primary-blue)" />
              <span>AI-Estimated Waiting Time</span>
            </div>

            {refreshing && !data.prediction ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0', fontWeight: '500' }}>
                Calculating estimated wait...
              </div>
            ) : data.patientsAhead === 0 ? (
              <div style={{ margin: '0.4rem 0' }}>
                <div className="patient-prediction-value">
                  ~2 min
                </div>
                <div style={{ fontSize: '0.80rem', color: '#059669', fontWeight: '700', marginTop: '0.2rem' }}>
                  You are next in line — please be prepared
                </div>
              </div>
            ) : data.prediction && data.prediction.lower_bound_minutes ? (
              <div style={{ margin: '0.4rem 0' }}>
                <div className="patient-prediction-value">
                  {data.prediction.lower_bound_minutes}–{data.prediction.upper_bound_minutes} min
                </div>
                <div style={{ fontSize: '0.78rem', color: '#1E40AF', marginTop: '0.25rem', fontWeight: '500' }}>
                  {data.prediction.message || 'Estimated wait based on current queue conditions'}
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    marginTop: '0.45rem',
                    fontSize: '0.70rem',
                    color: '#1D4ED8',
                    background: '#FFFFFF',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #BFDBFE'
                  }}
                >
                  <span>
                    Model: {data.prediction.is_cold_start
                      ? 'Clinical Specialty Prior (Calibrating)'
                      : data.prediction.is_fallback
                        ? 'Historical Median Baseline'
                        : 'AI Gradient Boosting v1.0'}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '0.45rem 0' }}>
                Estimated wait temporarily unavailable — learning from queue telemetry.
              </div>
            )}
          </div>
        )}

        {/* Sync Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '0.85rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.74rem',
            color: 'var(--text-muted)',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: connectionStatus === 'connected' ? '#10B981' : refreshing ? '#F59E0B' : '#94A3B8',
                flexShrink: 0
              }}
            />
            <span>{connectionStatus === 'connected' ? 'Real-time connected' : refreshing ? 'Updating...' : 'Synced via REST'}</span>
            {lastUpdated && (
              <span style={{ color: '#94A3B8' }}>
                • {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>

          <button
            onClick={() => fetchQueue(true)}
            disabled={refreshing}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#2563EB',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: '600',
              padding: '0.4rem 0.6rem',
              minHeight: '36px',
              touchAction: 'manipulation',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <RefreshIcon size={12} color="#2563EB" />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

      </div>

      {/* Hospital Footer Branding */}
      <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.72rem', color: '#94A3B8' }}>
        Invisible Queue AI • Smart Hospital Management System
      </div>
    </div>
  );
}
