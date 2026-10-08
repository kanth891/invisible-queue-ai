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
  const [graceSecondsRemaining, setGraceSecondsRemaining] = useState(null);

  // Modals and action states
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleOptions, setRescheduleOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  const [actionError, setActionError] = useState(null);

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

  // Grace Period countdown ticker
  useEffect(() => {
    if (!data || data.status !== 'CALLED' || !data.graceDeadline) {
      setGraceSecondsRemaining(null);
      return;
    }

    const updateGraceTime = () => {
      const deadline = new Date(data.graceDeadline).getTime();
      const diffSec = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setGraceSecondsRemaining(diffSec);

      if (diffSec <= 0) {
        // Backend authoritative reconciler will transition to MISSED
        fetchQueue();
      }
    };

    updateGraceTime();
    const interval = setInterval(updateGraceTime, 1000);
    return () => clearInterval(interval);
  }, [data, fetchQueue]);

  // Real-Time Socket.IO Synchronization & Reconnect Handling
  useEffect(() => {
    isMounted.current = true;
    fetchQueue();

    const socket = socketService.connect();
    socketService.joinPatient(accessToken);

    const unsubStatus = socketService.subscribeStatus((st) => {
      if (isMounted.current) setConnectionStatus(st);
    });

    const unsubReconnect = socketService.onReconnect(() => {
      fetchQueue();
    });

    // Real-time event listeners
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
      setData((prev) => (prev ? {
        ...prev,
        status: 'CALLED',
        isApproaching: false,
        patientsAhead: 0,
        position: 1,
        calledAt: payload.calledAt || new Date().toISOString(),
        graceDeadline: payload.graceDeadline || (payload.gracePeriodMinutes ? new Date(Date.now() + payload.gracePeriodMinutes * 60000).toISOString() : null),
        gracePeriodMinutes: payload.gracePeriodMinutes || prev.gracePeriodMinutes || 5,
      } : prev));
      notify({
        type: 'TURN',
        title: "IT'S YOUR TURN",
        message: payload.message || 'Your token has been called! Please proceed to the consultation room.',
        dedupeKey: `${accessToken}_TURN`,
        duration: 0,
      });
      setLastUpdated(new Date());
    };

    const handleConsultationStarted = () => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'IN_CONSULTATION' } : prev));
      setLastUpdated(new Date());
    };

    const handleConsultationCompleted = () => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'COMPLETED' } : prev));
      setLastUpdated(new Date());
    };

    const handlePatientMissed = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? {
        ...prev,
        status: 'MISSED',
        canRejoin: payload.canRejoin !== undefined ? payload.canRejoin : true,
      } : prev));
      notify({
        type: 'WARNING',
        title: 'Token Missed',
        message: payload.message || 'Your token was missed. You may rejoin the end of the queue or consult reception.',
        dedupeKey: `${accessToken}_MISSED`,
      });
      setLastUpdated(new Date());
    };

    const handlePatientRejoined = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? {
        ...prev,
        status: 'WAITING',
        position: payload.position,
        patientsAhead: payload.patientsAhead,
        rejoinCount: payload.rejoinCount,
        canRejoin: payload.canRejoin,
        prediction: payload.prediction || prev.prediction,
      } : prev));
      notify({
        type: 'SUCCESS',
        title: 'Rejoined Queue',
        message: `You have rejoined the queue at position #${payload.position}.`,
        dedupeKey: `${accessToken}_REJOINED`,
      });
      setLastUpdated(new Date());
    };

    const handlePatientRescheduled = (payload) => {
      if (!isMounted.current) return;
      fetchQueue();
      notify({
        type: 'INFO',
        title: 'Queue Rescheduled',
        message: `Your visit was rescheduled to ${payload.doctorName || 'new doctor'}.`,
        dedupeKey: `${accessToken}_RESCHEDULED`,
      });
    };

    const handleQueueTransferred = (payload) => {
      if (!isMounted.current) return;
      fetchQueue();
      notify({
        type: 'INFO',
        title: 'Queue Transferred',
        message: `Your consultation has been transferred to ${payload.targetDoctorName || 'another doctor'}.`,
        dedupeKey: `${accessToken}_TRANSFERRED`,
      });
    };

    const handleQueuePaused = (payload) => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, isDoctorPaused: true, doctorPauseReason: payload.reason } : prev));
      setLastUpdated(new Date());
    };

    const handleQueueResumed = () => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, isDoctorPaused: false, doctorPauseReason: null } : prev));
      setLastUpdated(new Date());
    };

    const handleNoShow = () => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'NO_SHOW' } : prev));
      setLastUpdated(new Date());
    };

    const handleCancelled = () => {
      if (!isMounted.current) return;
      setData((prev) => (prev ? { ...prev, status: 'CANCELLED' } : prev));
      setLastUpdated(new Date());
    };

    socket.on(SOCKET_EVENTS.WAIT_TIME_UPDATED, handleWaitTimeUpdated);
    socket.on(SOCKET_EVENTS.PATIENT_APPROACHING, handlePatientApproaching);
    socket.on(SOCKET_EVENTS.PATIENT_TURN, handlePatientTurn);
    socket.on(SOCKET_EVENTS.CONSULTATION_STARTED, handleConsultationStarted);
    socket.on(SOCKET_EVENTS.CONSULTATION_COMPLETED, handleConsultationCompleted);
    socket.on(SOCKET_EVENTS.PATIENT_MISSED, handlePatientMissed);
    socket.on(SOCKET_EVENTS.PATIENT_REJOINED, handlePatientRejoined);
    socket.on(SOCKET_EVENTS.PATIENT_RESCHEDULED, handlePatientRescheduled);
    socket.on(SOCKET_EVENTS.QUEUE_TRANSFERRED, handleQueueTransferred);
    socket.on(SOCKET_EVENTS.QUEUE_PAUSED, handleQueuePaused);
    socket.on(SOCKET_EVENTS.QUEUE_RESUMED, handleQueueResumed);
    socket.on(SOCKET_EVENTS.PATIENT_NO_SHOW, handleNoShow);
    socket.on(SOCKET_EVENTS.QUEUE_CANCELLED, handleCancelled);

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
      socket.off(SOCKET_EVENTS.PATIENT_MISSED, handlePatientMissed);
      socket.off(SOCKET_EVENTS.PATIENT_REJOINED, handlePatientRejoined);
      socket.off(SOCKET_EVENTS.PATIENT_RESCHEDULED, handlePatientRescheduled);
      socket.off(SOCKET_EVENTS.QUEUE_TRANSFERRED, handleQueueTransferred);
      socket.off(SOCKET_EVENTS.QUEUE_PAUSED, handleQueuePaused);
      socket.off(SOCKET_EVENTS.QUEUE_RESUMED, handleQueueResumed);
      socket.off(SOCKET_EVENTS.PATIENT_NO_SHOW, handleNoShow);
      socket.off(SOCKET_EVENTS.QUEUE_CANCELLED, handleCancelled);
    };
  }, [accessToken, fetchQueue, notify]);

  // Handle Patient Actions
  const handleCancelQueue = async () => {
    if (cancelling) return;
    setCancelling(true);
    setActionError(null);
    try {
      await queueAPI.patientCancel(accessToken, cancelReason);
      setShowCancelModal(false);
      await fetchQueue();
    } catch (err) {
      setActionError(err.message || 'Failed to cancel queue entry');
    } finally {
      setCancelling(false);
    }
  };

  const handleRejoinQueue = async () => {
    if (rejoining) return;
    setRejoining(true);
    setActionError(null);
    try {
      await queueAPI.patientRejoin(accessToken);
      await fetchQueue();
    } catch (err) {
      setActionError(err.message || 'Failed to rejoin queue');
    } finally {
      setRejoining(false);
    }
  };

  const openRescheduleModal = async () => {
    setShowRescheduleModal(true);
    setLoadingOptions(true);
    setActionError(null);
    try {
      const res = await queueAPI.patientRescheduleOptions(accessToken);
      setRescheduleOptions(res.data.availableDoctors || []);
      if (res.data.availableDoctors?.length > 0) {
        setSelectedDoctorId(res.data.availableDoctors[0].id);
      }
    } catch (err) {
      setActionError(err.message || 'Failed to load alternative doctors');
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleRescheduleSubmit = async () => {
    if (rescheduling || !selectedDoctorId) return;
    setRescheduling(true);
    setActionError(null);
    try {
      await queueAPI.patientReschedule(accessToken, selectedDoctorId);
      setShowRescheduleModal(false);
      await fetchQueue();
    } catch (err) {
      setActionError(err.message || 'Failed to reschedule queue');
    } finally {
      setRescheduling(false);
    }
  };

  const formatCountdown = (totalSec) => {
    if (totalSec === null || totalSec === undefined) return '--:--';
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

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
              borderRadius: 'var(--radius-sm)',
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

        {/* Doctor Paused Banner */}
        {data.isDoctorPaused && ['WAITING', 'CALLED'].includes(data.status) && (
          <div
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #F59E0B',
              borderRadius: 'var(--radius-md)',
              padding: '0.90rem 1rem',
              marginBottom: '1.25rem',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.90rem', fontWeight: '800', color: '#B45309', marginBottom: '0.2rem' }}>
              <AlertTriangleIcon size={18} color="#D97706" />
              <span>Queue Temporarily Paused</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#92400E', lineHeight: 1.45 }}>
              The doctor is attending to a brief interruption ({data.doctorPauseReason || 'In-between duties'}). Your position #{data.position ?? 1} in queue is securely preserved.
            </div>
          </div>
        )}

        {/* Doctor Transferred Notice */}
        {data.isTransferred && ['WAITING', 'CALLED'].includes(data.status) && (
          <div
            style={{
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderLeft: '4px solid #16A34A',
              borderRadius: 'var(--radius-md)',
              padding: '0.85rem 1rem',
              marginBottom: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem', fontWeight: '800', color: '#166534', marginBottom: '0.15rem' }}>
              <CheckCircleIcon size={16} color="#16A34A" />
              <span>Queue Transferred</span>
            </div>
            <div style={{ fontSize: '0.80rem', color: '#14532D', lineHeight: 1.4 }}>
              Your consultation was seamlessly transferred to {data.doctor}{data.roomNumber ? ` in Room ${data.roomNumber}` : ''}.
            </div>
          </div>
        )}

        {/* ── Clinical Alerts & Status ── */}

        {/* 1. YOUR TURN (Called) - Prominent Notice with Backend-Authoritative Grace Countdown */}
        {isCalled && (
          <div
            style={{
              background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
              border: '2px solid #2563EB',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem 1rem',
              marginBottom: '1.35rem',
              textAlign: 'center',
              boxShadow: '0 8px 25px rgba(37, 99, 235, 0.2)',
              animation: 'pulseGlow 2s infinite ease-in-out',
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.2rem', fontWeight: '900', fontFamily: 'var(--font-heading)', color: '#1D4ED8', marginBottom: '0.35rem', letterSpacing: '0.01em' }}>
              <PulseIcon size={20} color="#2563EB" />
              <span>YOUR TOKEN HAS BEEN CALLED</span>
            </div>
            <div style={{ fontSize: '0.90rem', color: '#1E40AF', lineHeight: 1.45, fontWeight: '600' }}>
              Please proceed to {data.roomNumber ? `Room ${data.roomNumber}` : 'the consultation area'} for {data.doctor}.
            </div>

            {/* Grace countdown timer */}
            {graceSecondsRemaining !== null && (
              <div
                style={{
                  marginTop: '0.85rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: graceSecondsRemaining < 60 ? '#FEE2E2' : '#FFFFFF',
                  border: `1px solid ${graceSecondsRemaining < 60 ? '#F87171' : '#93C5FD'}`,
                  borderRadius: 'var(--radius-full)',
                  padding: '0.35rem 0.85rem',
                  color: graceSecondsRemaining < 60 ? '#B91C1C' : '#1E40AF',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                }}
              >
                <ClockIcon size={16} color={graceSecondsRemaining < 60 ? '#DC2626' : '#2563EB'} />
                <span>Grace period remaining: {formatCountdown(graceSecondsRemaining)}</span>
              </div>
            )}
          </div>
        )}

        {/* 2. MISSED TOKEN - Rejoin or Cancel options */}
        {data.status === 'MISSED' && (
          <div
            style={{
              background: '#FFF1F2',
              border: '1px solid #FECDD3',
              borderLeft: '4px solid #E11D48',
              borderRadius: 'var(--radius-md)',
              padding: '1.2rem 1rem',
              marginBottom: '1.35rem',
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.1rem', fontWeight: '900', fontFamily: 'var(--font-heading)', color: '#BE123C', marginBottom: '0.35rem' }}>
              <AlertTriangleIcon size={20} color="#E11D48" />
              <span>Your Token Was Missed</span>
            </div>
            <p style={{ fontSize: '0.84rem', color: '#9F1239', lineHeight: 1.45, marginBottom: '1rem' }}>
              You were not present when your token was called. You can rejoin the queue to be placed at the end of the line, or cancel your visit.
            </p>

            {actionError && (
              <div style={{ background: '#FFE4E6', color: '#9F1239', padding: '0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                {actionError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {data.canRejoin ? (
                <button
                  onClick={handleRejoinQueue}
                  disabled={rejoining}
                  className="btn-primary"
                  style={{
                    padding: '0.55rem 1.25rem',
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    background: '#E11D48',
                    borderColor: '#E11D48',
                    minHeight: '40px',
                  }}
                >
                  {rejoining ? 'Rejoining...' : `Rejoin Queue (${data.rejoinCount || 0}/${data.maxRejoins || 2})`}
                </button>
              ) : (
                <div style={{ fontSize: '0.80rem', color: '#881337', fontWeight: '600' }}>
                  Maximum rejoins reached ({data.rejoinCount}/{data.maxRejoins}). Please see reception.
                </div>
              )}

              <button
                onClick={() => setShowCancelModal(true)}
                disabled={rejoining}
                className="btn-secondary"
                style={{
                  padding: '0.55rem 1rem',
                  fontSize: '0.85rem',
                  minHeight: '40px',
                }}
              >
                Cancel Visit
              </button>
            </div>
          </div>
        )}

        {/* 3. APPROACHING TURN - Clinical Pre-Warning */}
        {isApproaching && (
          <div
            style={{
              background: 'linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 100%)',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #D97706',
              borderRadius: 'var(--radius-md)',
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
              Only <strong>{data.patientsAhead}</strong> patient{data.patientsAhead === 1 ? '' : 's'} ahead. Please start making your way back to {data.roomNumber ? `Room ${data.roomNumber}` : 'the consultation area'}.
            </div>
          </div>
        )}

        {/* 4. In Consultation */}
        {isConsulting && (
          <div
            style={{
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: 'var(--radius-md)',
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
              You are currently consulting with {data.doctor}{data.roomNumber ? ` in Room ${data.roomNumber}` : ''}.
            </div>
          </div>
        )}

        {/* 5. Consultation Completed */}
        {isCompleted && (
          <div
            style={{
              background: '#F1F5F9',
              border: '1px solid #E2E8F0',
              borderRadius: 'var(--radius-md)',
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

        {/* 6. Consultation Cancelled */}
        {data.status === 'CANCELLED' && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 'var(--radius-md)',
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

        {/* 7. Marked as No-Show */}
        {data.status === 'NO_SHOW' && (
          <div
            style={{
              background: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderLeft: '4px solid #D97706',
              borderRadius: 'var(--radius-md)',
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
              borderRadius: 'var(--radius-full)',
              marginBottom: '1.35rem',
              fontSize: '0.84rem',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              textAlign: 'center'
            }}
          >
            <span className="status-dot status-dot--waiting" />
            <span>Waiting in Queue - Position #{data.position ?? 1}</span>
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
              {data.currentToken || '-'}
            </div>
          </div>

          {/* Your Position */}
          <div className="patient-metric-box">
            <div className="patient-metric-label">Position</div>
            <div
              className="patient-metric-value"
              style={{ color: data.position !== null ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              {data.position !== null ? `#${data.position}` : '-'}
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
              borderRadius: 'var(--radius-md)',
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
              borderRadius: 'var(--radius-md)',
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
              borderRadius: 'var(--radius-md)',
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
                  You are next in line. Please be prepared.
                </div>
              </div>
            ) : data.prediction && data.prediction.lower_bound_minutes ? (
              <div style={{ margin: '0.4rem 0' }}>
                <div className="patient-prediction-value">
                  {data.prediction.lower_bound_minutes}-{data.prediction.upper_bound_minutes} min
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
                    borderRadius: 'var(--radius-full)',
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
                Estimated wait temporarily unavailable. Calibrating from queue telemetry.
              </div>
            )}
          </div>
        )}

        {/* ── Patient Self-Service Action Bar (Cancel / Reschedule) ── */}
        {['WAITING', 'CALLED'].includes(data.status) && (data.canCancel || data.canReschedule) && (
          <div
            style={{
              display: 'flex',
              gap: '0.65rem',
              marginBottom: '1.35rem',
              flexWrap: 'wrap',
            }}
          >
            {data.canReschedule && (
              <button
                type="button"
                onClick={openRescheduleModal}
                disabled={rescheduling || cancelling}
                className="btn-secondary"
                style={{
                  flex: '1 1 140px',
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  minHeight: '38px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                }}
              >
                <span>Reschedule Visit</span>
                <span style={{ fontSize: '0.72rem', opacity: 0.75 }}>
                  ({data.rescheduleCount || 0}/{data.maxReschedules || 2})
                </span>
              </button>
            )}

            {data.canCancel && (
              <button
                type="button"
                onClick={() => setShowCancelModal(true)}
                disabled={rescheduling || cancelling}
                style={{
                  flex: '1 1 120px',
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  minHeight: '38px',
                  background: 'transparent',
                  border: '1px solid #FECACA',
                  color: '#DC2626',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#FEF2F2')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Cancel Queue
              </button>
            )}
          </div>
        )}

        {/* Cancel Confirmation Modal */}
        {showCancelModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(15, 23, 42, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '1rem',
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: '420px',
                width: '100%',
                padding: '1.5rem',
                border: '1px solid #FECACA',
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#DC2626', marginBottom: '0.75rem' }}>
                <AlertTriangleIcon size={22} color="#DC2626" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: '800', margin: 0 }}>Cancel Consultation?</h3>
              </div>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem' }}>
                Are you sure you want to cancel your queue spot for <strong>{data.token}</strong>? You will forfeit your position #{data.position ?? 1} and will stop receiving turn alerts.
              </p>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Reason (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., Feeling better, emergency, schedule conflict"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.84rem',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              </div>

              {actionError && (
                <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: '0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                  {actionError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowCancelModal(false); setActionError(null); }}
                  disabled={cancelling}
                  className="btn-secondary"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
                >
                  Keep My Spot
                </button>
                <button
                  type="button"
                  onClick={handleCancelQueue}
                  disabled={cancelling}
                  className="btn-primary"
                  style={{
                    padding: '0.45rem 1rem',
                    fontSize: '0.82rem',
                    background: '#DC2626',
                    borderColor: '#DC2626',
                  }}
                >
                  {cancelling ? 'Cancelling...' : 'Yes, Cancel Queue'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reschedule Modal */}
        {showRescheduleModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(15, 23, 42, 0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '1rem',
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: '460px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: '1.5rem',
                boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0, color: 'var(--text-primary)' }}>
                  Same-Day Reschedule
                </h3>
                <button
                  onClick={() => { setShowRescheduleModal(false); setActionError(null); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94A3B8' }}
                >
                  ✕
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: '1rem' }}>
                Select an available doctor in <strong>{data.department}</strong> for today. You will receive a new queue position based on their current line.
              </p>

              {loadingOptions ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  <div className="spinner" style={{ width: '24px', height: '24px', margin: '0 auto 0.75rem auto' }} />
                  Checking real-time doctor availability...
                </div>
              ) : rescheduleOptions.length === 0 ? (
                <div style={{ background: '#F8FAFC', padding: '1.25rem', borderRadius: 'var(--radius-md)', textAlign: 'center', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  No alternative doctors are currently available in this department today.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.25rem' }}>
                  {rescheduleOptions.map((doc) => {
                    const isSelected = selectedDoctorId === doc.id;
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDoctorId(doc.id)}
                        style={{
                          padding: '0.85rem 1rem',
                          borderRadius: 'var(--radius-md)',
                          border: `2px solid ${isSelected ? 'var(--primary-blue)' : 'var(--border-subtle)'}`,
                          background: isSelected ? '#EFF6FF' : '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '0.90rem', color: 'var(--text-primary)' }}>
                            {doc.name}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                            {doc.specialization || 'Outpatient Clinic'}
                            {doc.room_number ? ` • Room ${doc.room_number}` : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              fontSize: '0.72rem',
                              fontWeight: '700',
                              background: isSelected ? '#DBEAFE' : '#F1F5F9',
                              color: isSelected ? '#1D4ED8' : '#475569',
                            }}
                          >
                            {doc.waitingCount ?? doc.patientsWaiting ?? 0} waiting
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {actionError && (
                <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: '0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                  {actionError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => { setShowRescheduleModal(false); setActionError(null); }}
                  disabled={rescheduling}
                  className="btn-secondary"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRescheduleSubmit}
                  disabled={rescheduling || loadingOptions || rescheduleOptions.length === 0 || !selectedDoctorId}
                  className="btn-primary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.82rem' }}
                >
                  {rescheduling ? 'Rescheduling...' : 'Confirm Reschedule'}
                </button>
              </div>
            </div>
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
