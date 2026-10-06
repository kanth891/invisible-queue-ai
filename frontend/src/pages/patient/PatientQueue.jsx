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
    socket.on(SOCKET_EVENTS.TOKEN_CALLED, handlePatientTurn);
    socket.on(SOCKET_EVENTS.CONSULTATION_STARTED, handleConsultationStarted);
    socket.on(SOCKET_EVENTS.CONSULTATION_COMPLETED, handleConsultationCompleted);
    socket.on(SOCKET_EVENTS.PATIENT_NO_SHOW, handleNoShow);
    socket.on(SOCKET_EVENTS.PATIENT_CANCELLED, handleCancelled);

    // 3. Fallback polling for network resilience
    const intervalId = setInterval(() => {
      if (data && ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(data.status)) {
        return;
      }
      fetchQueue();
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => {
      isMounted.current = false;
      clearInterval(intervalId);
      unsubStatus();
      unsubReconnect();
      socket.off(SOCKET_EVENTS.WAIT_TIME_UPDATED, handleWaitTimeUpdated);
      socket.off(SOCKET_EVENTS.PATIENT_APPROACHING, handlePatientApproaching);
      socket.off(SOCKET_EVENTS.PATIENT_TURN, handlePatientTurn);
      socket.off(SOCKET_EVENTS.TOKEN_CALLED, handlePatientTurn);
      socket.off(SOCKET_EVENTS.CONSULTATION_STARTED, handleConsultationStarted);
      socket.off(SOCKET_EVENTS.CONSULTATION_COMPLETED, handleConsultationCompleted);
      socket.off(SOCKET_EVENTS.PATIENT_NO_SHOW, handleNoShow);
      socket.off(SOCKET_EVENTS.PATIENT_CANCELLED, handleCancelled);
      socketService.leavePatient(accessToken);
    };
  }, [accessToken, fetchQueue, notify]);

  if (loading && !data && !error) {
    return (
      <div className="patient-queue-container">
        <div className="patient-pass-card">
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <div className="spinner" style={{ margin: '0 auto 1.25rem auto' }} />
            <div style={{ color: '#64748B', fontSize: '0.9rem', fontWeight: '500' }}>
              Verifying outpatient pass...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="patient-queue-container">
        <div className="patient-pass-card" style={{ borderColor: '#FECACA' }}>
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
              <SearchIcon size={32} color="#EF4444" />
            </div>
            <h2 style={{ color: '#EF4444', fontSize: '1.15rem', fontWeight: '700', marginBottom: '0.4rem' }}>
              Digital Pass Not Found
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.85rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              {error}. Please check your token receipt slip or visit the hospital reception desk.
            </p>
            <button
              onClick={() => { setError(null); setLoading(true); fetchQueue(true); }}
              className="btn-primary"
              style={{ width: '100%', maxWidth: '240px' }}
            >
              Try Again
            </button>
          </div>
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
              width: '26px',
              height: '26px',
              borderRadius: '6px',
              background: '#0D9488',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <MedicalCrossIcon size={15} color="#FFFFFF" />
          </div>
          <span style={{ fontSize: '1.05rem', fontWeight: '800', letterSpacing: '-0.01em', color: '#0F5147' }}>
            Invisible Queue AI
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontSize: '0.75rem', color: '#64748B', letterSpacing: '0.02em', textTransform: 'uppercase', fontWeight: '500' }}>
          <span>Outpatient Digital Pass</span>
          <span>•</span>
          {connectionStatus === 'connected' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#0D9488', fontWeight: '700' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
              Live Sync
            </span>
          ) : connectionStatus === 'reconnecting' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#F59E0B', fontWeight: '700' }}>
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
          <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748B', fontWeight: '600' }}>
            Outpatient Token
          </div>
          <div className="patient-token-number">
            {data.token}
          </div>
          <div style={{ fontSize: '1rem', fontWeight: '700', color: '#0F172A', marginTop: '0.25rem', wordBreak: 'break-word' }}>
            {data.doctor}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#0284C7', fontWeight: '500', marginTop: '0.15rem' }}>
            {data.department}
          </div>
        </div>

        {/* ── Clinical Alerts & Status (Phase 4 Real-Time Hierarchy) ── */}

        {/* 1. YOUR TURN (Called) - Prominent Notice */}
        {isCalled && (
          <div
            style={{
              background: '#F0FDFA',
              border: '2px solid #0D9488',
              borderRadius: '10px',
              padding: '1.1rem 1rem',
              marginBottom: '1.25rem',
              textAlign: 'center',
              boxShadow: '0 4px 12px rgba(13, 148, 136, 0.12)',
              animation: 'pulseGlow 2s infinite ease-in-out',
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '1.15rem', fontWeight: '800', color: '#0F5147', marginBottom: '0.3rem', letterSpacing: '0.02em' }}>
              <PulseIcon size={18} color="#0D9488" />
              <span>IT'S YOUR TURN NOW</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#0F766E', lineHeight: 1.45, fontWeight: '500' }}>
              Your token <strong>{data.token}</strong> has been called. Please proceed immediately to the consultation room.
            </div>
          </div>
        )}

        {/* 2. APPROACHING TURN - Clinical Pre-Warning */}
        {isApproaching && (
          <div
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #F59E0B',
              borderRadius: '8px',
              padding: '0.85rem 0.9rem',
              marginBottom: '1.15rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem', fontWeight: '700', color: '#92400E', marginBottom: '0.2rem' }}>
              <span className="status-dot status-dot--waiting" />
              <span>Your Turn is Approaching</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#78350F', lineHeight: 1.4 }}>
              Only <strong>{data.patientsAhead}</strong> patient{data.patientsAhead === 1 ? '' : 's'} ahead. Please start making your way back to the consultation area.
            </div>
          </div>
        )}

        {/* 3. In Consultation */}
        {isConsulting && (
          <div
            style={{
              background: '#F0FDFA',
              border: '1px solid #CCFBF1',
              borderRadius: '8px',
              padding: '0.85rem 0.9rem',
              marginBottom: '1.15rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', fontWeight: '700', color: '#0F766E' }}>
              <StethoscopeIcon size={16} color="#0F766E" />
              <span>Consultation in Progress</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#0F766E', marginTop: '0.15rem' }}>
              You are currently consulting with {data.doctor}.
            </div>
          </div>
        )}

        {/* 4. Consultation Completed */}
        {isCompleted && (
          <div
            style={{
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: '8px',
              padding: '0.9rem',
              marginBottom: '1.15rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.92rem', fontWeight: '700', color: '#166534', marginBottom: '0.2rem' }}>
              <CheckCircleIcon size={16} color="#166534" />
              <span>Consultation Completed</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#166534' }}>
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
              borderRadius: '8px',
              padding: '0.9rem',
              marginBottom: '1.15rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.92rem', fontWeight: '700', color: '#991B1B', marginBottom: '0.2rem' }}>
              <XCircleIcon size={16} color="#DC2626" />
              <span>Consultation Token Cancelled</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#7F1D1D', lineHeight: 1.45 }}>
              This token has been cancelled. If this was done in error or you need assistance, please speak with the outpatient reception desk.
            </div>
          </div>
        )}

        {/* 6. Marked as No-Show */}
        {data.status === 'NO_SHOW' && (
          <div
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #F59E0B',
              borderRadius: '8px',
              padding: '0.85rem 0.9rem',
              marginBottom: '1.15rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem', fontWeight: '700', color: '#92400E', marginBottom: '0.2rem' }}>
              <AlertTriangleIcon size={16} color="#D97706" />
              <span>Marked as No-Show</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#78350F', lineHeight: 1.45 }}>
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
              gap: '0.45rem',
              padding: '0.45rem 0.75rem',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              marginBottom: '1.15rem',
              fontSize: '0.82rem',
              fontWeight: '500',
              color: '#334155',
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
              style={{ color: data.currentToken ? '#0D9488' : '#94A3B8' }}
            >
              {data.currentToken || '—'}
            </div>
          </div>

          {/* Your Position */}
          <div className="patient-metric-box">
            <div className="patient-metric-label">Position</div>
            <div
              className="patient-metric-value"
              style={{ color: data.position !== null ? '#0F172A' : '#94A3B8' }}
            >
              {data.position !== null ? `#${data.position}` : '—'}
            </div>
          </div>

          {/* Patients Ahead */}
          <div className="patient-metric-box">
            <div className="patient-metric-label">Ahead</div>
            <div
              className="patient-metric-value"
              style={{ color: data.patientsAhead > 0 ? '#D97706' : '#10B981' }}
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
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.75rem 0.85rem',
              marginBottom: '1.15rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.65rem'
            }}
          >
            <div style={{ marginTop: '0.15rem', flexShrink: 0 }}>
              <ClockIcon size={16} color="#0D9488" />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
              <strong style={{ color: '#0F172A' }}>Virtual Queue Active.</strong> You may relax in the cafeteria, outdoor courtyard, or lobby. This pass updates automatically in real-time.
            </div>
          </div>
        )}

        {/* Phase 4 Browser Notification Permission Banner (Opt-in only, no spam) */}
        {browserPermission === 'default' && ['WAITING', 'CALLED'].includes(data.status) && (
          <div
            style={{
              background: '#F0F9FF',
              border: '1px solid #BAE6FD',
              borderRadius: '8px',
              padding: '0.75rem 0.85rem',
              marginBottom: '1.15rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '0.76rem', color: '#0369A1', flex: '1 1 200px' }}>
              Want your device to ring when your turn approaches?
            </div>
            <button
              onClick={requestBrowserPermission}
              className="btn-primary"
              style={{
                padding: '0.35rem 0.65rem',
                fontSize: '0.74rem',
                minHeight: '32px',
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
              gap: '0.35rem',
              marginBottom: '1.15rem',
              fontSize: '0.72rem',
              color: '#0F766E',
              fontWeight: '500',
            }}
          >
            <CheckCircleIcon size={14} color="#10B981" />
            <span>Live device alerts enabled</span>
          </div>
        )}

        {/* Estimated Wait Time Box (Phase 3 & 4 AI Gradient Boosting / Fallback Range) */}
        {data.status === 'WAITING' && (
          <div
            style={{
              background: '#F0FDFA',
              border: '1px solid #99F6E4',
              borderRadius: '8px',
              padding: '0.85rem 0.95rem',
              marginBottom: '1.15rem',
              textAlign: 'center'
            }}
          >
            <div
              style={{
                fontSize: '0.70rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#0F766E',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem'
              }}
            >
              <PulseIcon size={13} color="#0D9488" />
              <span>AI-Estimated Waiting Time</span>
            </div>

            {refreshing && !data.prediction ? (
              <div style={{ fontSize: '0.85rem', color: '#64748B', margin: '0.45rem 0', fontWeight: '500' }}>
                Calculating estimated wait...
              </div>
            ) : data.patientsAhead === 0 ? (
              <div style={{ margin: '0.35rem 0' }}>
                <div className="patient-prediction-value">
                  ~2 min
                </div>
                <div style={{ fontSize: '0.78rem', color: '#0D9488', fontWeight: '600', marginTop: '0.15rem' }}>
                  You are next in line — please be prepared
                </div>
              </div>
            ) : data.prediction && data.prediction.lower_bound_minutes ? (
              <div style={{ margin: '0.35rem 0' }}>
                <div className="patient-prediction-value">
                  {data.prediction.lower_bound_minutes}–{data.prediction.upper_bound_minutes} min
                </div>
                <div style={{ fontSize: '0.76rem', color: '#0F766E', marginTop: '0.2rem', fontWeight: '500' }}>
                  {data.prediction.message || 'Estimated wait based on current queue conditions'}
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    marginTop: '0.35rem',
                    fontSize: '0.68rem',
                    color: '#64748B',
                    background: '#FFFFFF',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '4px',
                    border: '1px solid #CCFBF1'
                  }}
                >
                  <span>Model: {data.prediction.is_fallback ? 'Historical Median Baseline' : 'AI Gradient Boosting v1.0'}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: '#64748B', margin: '0.4rem 0' }}>
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
            paddingTop: '0.75rem',
            borderTop: '1px solid #E2E8F0',
            fontSize: '0.72rem',
            color: '#64748B',
            flexWrap: 'wrap',
            gap: '0.4rem'
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
              color: '#0D9488',
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
            <RefreshIcon size={12} color="#0D9488" />
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
