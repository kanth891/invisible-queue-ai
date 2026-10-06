import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { queueAPI } from '../../services/api';

const DEFAULT_POLL_INTERVAL_MS = 6000;

export default function PatientQueue() {
  const { accessToken } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
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

  useEffect(() => {
    isMounted.current = true;
    fetchQueue();

    // Auto-polling interval
    const intervalId = setInterval(() => {
      // Don't poll if consultation is completed or cancelled
      if (data && ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(data.status)) {
        return;
      }
      fetchQueue();
    }, DEFAULT_POLL_INTERVAL_MS);

    return () => {
      isMounted.current = false;
      clearInterval(intervalId);
    };
  }, [fetchQueue, data?.status]);

  if (loading && !data && !error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <div className="spinner" style={{ margin: '0 auto 1.5rem auto' }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Connecting to Invisible Queue...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, border: '1px solid rgba(251, 113, 133, 0.3)' }}>
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
            <h2 style={{ color: 'var(--accent-rose)', marginBottom: '0.75rem' }}>Queue Token Not Found</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              {error}. The link may be invalid, expired, or mistyped. Please check your QR code or consult the hospital reception desk.
            </p>
            <button
              onClick={() => { setError(null); setLoading(true); fetchQueue(true); }}
              style={refreshBtnStyle}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Determine computed status display
  let statusBadgeText = data.status;
  let statusBadgeColor = 'var(--accent-amber)';
  let statusBg = 'rgba(251, 191, 36, 0.15)';

  if (data.status === 'WAITING') {
    if (data.isApproaching) {
      statusBadgeText = 'YOUR TURN IS APPROACHING';
      statusBadgeColor = '#f59e0b';
      statusBg = 'rgba(245, 158, 11, 0.2)';
    } else {
      statusBadgeText = 'WAITING';
      statusBadgeColor = 'var(--accent-cyan)';
      statusBg = 'rgba(34, 211, 238, 0.15)';
    }
  } else if (data.status === 'CALLED') {
    statusBadgeText = 'CALLED — ENTER NOW';
    statusBadgeColor = 'var(--accent-violet)';
    statusBg = 'rgba(167, 139, 250, 0.25)';
  } else if (data.status === 'IN_CONSULTATION') {
    statusBadgeText = 'IN CONSULTATION';
    statusBadgeColor = 'var(--accent-emerald)';
    statusBg = 'rgba(52, 211, 153, 0.2)';
  } else if (data.status === 'COMPLETED') {
    statusBadgeText = 'COMPLETED';
    statusBadgeColor = 'var(--text-secondary)';
    statusBg = 'rgba(148, 163, 184, 0.15)';
  } else {
    statusBadgeText = data.status.replace('_', ' ');
    statusBadgeColor = 'var(--accent-rose)';
    statusBg = 'rgba(251, 113, 133, 0.2)';
  }

  return (
    <div style={containerStyle}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '8px',
            background: 'var(--gradient-primary)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem'
          }}>
            ⚡
          </div>
          <span style={{
            fontSize: '1rem', fontWeight: '800', letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-primary)'
          }}>
            Invisible Queue AI
          </span>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Virtual Hospital Queue Tracker
        </div>
      </div>

      {/* Main Patient Card */}
      <div style={cardStyle}>
        
        {/* Token Banner */}
        <div style={{ textAlign: 'center', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '0.3rem' }}>
            Your Token
          </div>
          <div style={{
            fontSize: '3.5rem',
            fontWeight: '900',
            letterSpacing: '0.04em',
            background: 'linear-gradient(135deg, #ffffff 0%, var(--accent-indigo) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1.1,
            margin: '0.2rem 0'
          }}>
            {data.token}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {data.doctor}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)' }}>
            {data.department}
          </div>
        </div>

        {/* Live Status Badge */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '1.25rem 0' }}>
          <div style={{
            background: statusBg,
            color: statusBadgeColor,
            border: `1px solid ${statusBadgeColor}44`,
            padding: '0.5rem 1.25rem',
            borderRadius: '100px',
            fontSize: '0.85rem',
            fontWeight: '800',
            letterSpacing: '0.05em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: `0 0 16px ${statusBadgeColor}22`
          }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              backgroundColor: statusBadgeColor,
              animation: data.status === 'CALLED' || data.isApproaching ? 'pulse 1.5s infinite' : 'none'
            }} />
            {statusBadgeText}
          </div>
        </div>

        {/* Approaching Turn Banner */}
        {data.status === 'WAITING' && data.isApproaching && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.1) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#f59e0b', marginBottom: '0.25rem' }}>
              ⚠️ Your turn is approaching
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Please prepare to return to the consultation area.
            </div>
          </div>
        )}

        {/* Called Banner */}
        {data.status === 'CALLED' && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(167, 139, 250, 0.25) 0%, rgba(99, 102, 241, 0.15) 100%)',
            border: '2px solid var(--accent-violet)',
            borderRadius: '12px',
            padding: '1.25rem 1rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.25rem', fontWeight: '900', color: 'white', marginBottom: '0.25rem' }}>
              🔔 The doctor is calling you!
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: '500' }}>
              Please proceed to the consultation room immediately.
            </div>
          </div>
        )}

        {/* In Consultation Banner */}
        {data.status === 'IN_CONSULTATION' && (
          <div style={{
            background: 'rgba(52, 211, 153, 0.15)',
            border: '1px solid rgba(52, 211, 153, 0.4)',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--accent-emerald)' }}>
              🩺 Consultation In Progress
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              You are currently consulting with {data.doctor}.
            </div>
          </div>
        )}

        {/* Completed Banner */}
        {data.status === 'COMPLETED' && (
          <div style={{
            background: 'rgba(148, 163, 184, 0.1)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '12px',
            padding: '1.25rem 1rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-emerald)', marginBottom: '0.25rem' }}>
              ✅ Consultation Completed
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Thank you for using Invisible Queue AI. Have a healthy day!
            </div>
          </div>
        )}

        {/* Live Queue Position Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        }}>
          {/* Currently Serving */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Current Serving</div>
            <div style={{
              fontSize: '1.4rem',
              fontWeight: '800',
              color: data.currentToken ? 'var(--accent-indigo)' : 'var(--text-muted)',
              marginTop: '0.25rem'
            }}>
              {data.currentToken || '—'}
            </div>
          </div>

          {/* Your Position */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Your Position</div>
            <div style={{
              fontSize: '1.4rem',
              fontWeight: '800',
              color: data.position !== null ? 'white' : 'var(--text-muted)',
              marginTop: '0.25rem'
            }}>
              {data.position !== null ? data.position : '—'}
            </div>
          </div>

          {/* Patients Ahead */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Patients Ahead</div>
            <div style={{
              fontSize: '1.4rem',
              fontWeight: '800',
              color: data.patientsAhead > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)',
              marginTop: '0.25rem'
            }}>
              {data.patientsAhead !== null ? data.patientsAhead : '0'}
            </div>
          </div>
        </div>

        {/* Virtual Queue Freedom Message */}
        {['WAITING', 'CALLED'].includes(data.status) && (
          <div style={{
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: '10px',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem'
          }}>
            <span style={{ fontSize: '1.25rem' }}>☕</span>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-primary)' }}>You can leave the waiting area.</strong> Feel free to visit the cafeteria, pharmacy, or relax outdoors. Keep this page open to track your turn.
            </div>
          </div>
        )}

        {/* Phase 3 Waiting Time Prediction Placeholder */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px dashed var(--border-subtle)',
          borderRadius: '10px',
          padding: '0.85rem 1rem',
          marginBottom: '1.5rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: '600' }}>
            Estimated Wait Time
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem', fontWeight: '500' }}>
            Waiting time prediction available soon in Phase 3
          </div>
        </div>

        {/* Polling / Sync Status Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '0.75rem',
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              backgroundColor: refreshing ? 'var(--accent-amber)' : 'var(--accent-emerald)',
              boxShadow: refreshing ? '0 0 6px var(--accent-amber)' : '0 0 6px var(--accent-emerald)'
            }} />
            <span>{refreshing ? 'Updating...' : 'Live sync active'}</span>
            {lastUpdated && (
              <span style={{ opacity: 0.7 }}>
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
              color: 'var(--accent-cyan)',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: '600',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px'
            }}
          >
            {refreshing ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>

      </div>

      {/* Safety notice */}
      <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Invisible Queue AI • Smart Hospital Management System
      </div>
    </div>
  );
}

const containerStyle = {
  minHeight: '100vh',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem 1rem',
  background: 'var(--bg-primary, #0a0e1a)',
  boxSizing: 'border-box'
};

const cardStyle = {
  width: '100%',
  maxWidth: '440px',
  background: 'var(--bg-card, rgba(17, 24, 39, 0.8))',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
  borderRadius: '20px',
  padding: '1.75rem 1.5rem',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5), 0 0 30px rgba(99, 102, 241, 0.08)',
  backdropFilter: 'blur(20px)',
  boxSizing: 'border-box'
};

const metricBoxStyle = {
  background: 'rgba(0, 0, 0, 0.25)',
  border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))',
  borderRadius: '12px',
  padding: '0.85rem 0.5rem',
  textAlign: 'center'
};

const metricLabelStyle = {
  fontSize: '0.7rem',
  color: 'var(--text-muted, #94a3b8)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: '600'
};

const refreshBtnStyle = {
  padding: '0.6rem 1.25rem',
  background: 'var(--accent-indigo)',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '0.9rem'
};
