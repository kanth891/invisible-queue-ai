import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { queueAPI } from '../../services/api';
import { MedicalCrossIcon, SearchIcon, StethoscopeIcon, CheckCircleIcon, ClockIcon } from '../../components/Icons';

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
          <div style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <div className="spinner" style={{ margin: '0 auto 1.25rem auto' }} />
            <div style={{ color: 'var(--text-secondary, #64748B)', fontSize: '0.95rem', fontWeight: '500' }}>
              Connecting to live queue...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, border: '1px solid #FECACA' }}>
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
              <SearchIcon size={36} color="#EF4444" />
            </div>
            <h2 style={{ color: '#EF4444', fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem' }}>
              Queue Token Not Found
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.88rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              {error}. Please check your QR code slip or speak with the reception desk.
            </p>
            <button
              onClick={() => { setError(null); setLoading(true); fetchQueue(true); }}
              className="btn-primary"
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
    <div style={containerStyle}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '7px',
              background: '#0D9488',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <MedicalCrossIcon size={16} color="#FFFFFF" />
          </div>
          <span style={{ fontSize: '1rem', fontWeight: '800', letterSpacing: '-0.01em', color: '#1E293B' }}>
            Invisible Queue AI
          </span>
        </div>
        <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
          Virtual Hospital Queue Tracker
        </div>
      </div>

      {/* Main Patient Card */}
      <div style={cardStyle}>
        
        {/* Dominant Token Section */}
        <div
          style={{
            textAlign: 'center',
            paddingBottom: '1.5rem',
            borderBottom: '1px solid #E2E8F0',
            background: '#FAFCFD',
            margin: '-1.75rem -1.75rem 1.25rem -1.75rem',
            padding: '1.75rem 1.5rem 1.25rem 1.5rem',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px'
          }}
        >
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', fontWeight: '700', marginBottom: '0.25rem' }}>
            YOUR TOKEN
          </div>
          <div
            style={{
              fontSize: '3.75rem',
              fontWeight: '900',
              letterSpacing: '0.02em',
              color: '#0F766E',
              lineHeight: 1.1,
              margin: '0.2rem 0'
            }}
          >
            {data.token}
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: '600', color: '#1E293B', marginTop: '0.35rem' }}>
            {data.doctor}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#0284C7', fontWeight: '500' }}>
            {data.department}
          </div>
        </div>

        {/* ── Status Alert Banners ── */}

        {/* 1. YOUR TURN (Called) - Calm Teal / Success Treatment */}
        {isCalled && (
          <div
            style={{
              background: '#F0FDFA',
              border: '2px solid #99F6E4',
              borderRadius: '12px',
              padding: '1.25rem 1rem',
              marginBottom: '1.25rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10B981', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#0D9488', letterSpacing: '0.04em' }}>
                YOUR TURN
              </span>
            </div>
            <div style={{ fontSize: '0.88rem', color: '#0F766E', fontWeight: '500' }}>
              The doctor is ready to see you. Please proceed to the consultation room now.
            </div>
          </div>
        )}

        {/* 2. APPROACHING TURN - Soft Amber Treatment */}
        {isApproaching && (
          <div
            style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: '12px',
              padding: '1rem',
              marginBottom: '1.25rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.25rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '0.98rem', fontWeight: '700', color: '#92400E' }}>
                Your turn is approaching
              </span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#92400E', lineHeight: 1.4 }}>
              Get ready — you are next in line. Please return towards the consultation area.
            </div>
          </div>
        )}

        {/* 3. In Consultation */}
        {isConsulting && (
          <div
            style={{
              background: '#CCFBF1',
              border: '1px solid #99F6E4',
              borderRadius: '12px',
              padding: '1rem',
              marginBottom: '1.25rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.95rem', fontWeight: '700', color: '#0F766E', marginBottom: '0.2rem' }}>
              <StethoscopeIcon size={18} color="#0F766E" />
              <span>Consultation In Progress</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#0F766E' }}>
              You are currently consulting with {data.doctor}.
            </div>
          </div>
        )}

        {/* 4. Consultation Completed */}
        {isCompleted && (
          <div
            style={{
              background: '#D1FAE5',
              border: '1px solid #A7F3D0',
              borderRadius: '12px',
              padding: '1.25rem 1rem',
              marginBottom: '1.25rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.05rem', fontWeight: '700', color: '#065F46', marginBottom: '0.25rem' }}>
              <CheckCircleIcon size={18} color="#065F46" />
              <span>Consultation Completed</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#065F46' }}>
              Thank you for visiting today. We wish you a speedy recovery!
            </div>
          </div>
        )}

        {/* Normal Waiting Badge (When not yet approaching) */}
        {data.status === 'WAITING' && !data.isApproaching && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
            <span
              style={{
                background: '#FEF3C7',
                color: '#92400E',
                border: '1px solid #FDE68A',
                padding: '0.4rem 1rem',
                borderRadius: '100px',
                fontSize: '0.82rem',
                fontWeight: '700',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
              WAITING IN QUEUE
            </span>
          </div>
        )}

        {/* ── Key Metrics Grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.75rem',
            marginBottom: '1.25rem'
          }}
        >
          {/* Currently Serving */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Currently Serving</div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: '800',
                color: data.currentToken ? '#0D9488' : '#94A3B8',
                marginTop: '0.25rem'
              }}
            >
              {data.currentToken || '—'}
            </div>
          </div>

          {/* Your Position */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Your Position</div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: '800',
                color: data.position !== null ? '#1E293B' : '#94A3B8',
                marginTop: '0.25rem'
              }}
            >
              {data.position !== null ? `#${data.position}` : '—'}
            </div>
          </div>

          {/* Patients Ahead */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Patients Ahead</div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: '800',
                color: data.patientsAhead > 0 ? '#F59E0B' : '#10B981',
                marginTop: '0.25rem'
              }}
            >
              {data.patientsAhead !== null ? data.patientsAhead : '0'}
            </div>
          </div>
        </div>

        {/* Virtual Queue Freedom Message */}
        {['WAITING', 'CALLED'].includes(data.status) && (
          <div
            style={{
              background: '#F0FDFA',
              border: '1px solid #CCFBF1',
              borderRadius: '10px',
              padding: '0.85rem 1rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.65rem'
            }}
          >
            <div style={{ marginTop: '0.1rem', flexShrink: 0 }}>
              <ClockIcon size={18} color="#0D9488" />
            </div>
            <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
              <strong style={{ color: '#0F766E' }}>You do not need to wait in the hallway.</strong> Feel free to visit the cafe, pharmacy, or outdoor benches. Keep this page open to track your turn in real time.
            </div>
          </div>
        )}

        {/* Estimated Wait Time Box */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px dashed #CBD5E1',
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', fontWeight: '700' }}>
            Estimated Wait Time
          </div>
          <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '0.2rem', fontWeight: '500' }}>
            AI Waiting time prediction launching soon in Phase 3
          </div>
        </div>

        {/* Polling & Sync Status Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '0.75rem',
            borderTop: '1px solid #E2E8F0',
            fontSize: '0.75rem',
            color: '#64748B'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: refreshing ? '#F59E0B' : '#10B981'
              }}
            />
            <span>{refreshing ? 'Syncing...' : 'Live sync active'}</span>
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
              fontWeight: '700',
              padding: '0.2rem 0.4rem'
            }}
          >
            {refreshing ? 'Updating...' : '↻ Refresh'}
          </button>
        </div>

      </div>

      {/* Safety notice */}
      <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.75rem', color: '#94A3B8' }}>
        Invisible Queue AI • Smart Healthcare Virtual Queue
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
  backgroundColor: '#F8FAFC',
  boxSizing: 'border-box'
};

const cardStyle = {
  width: '100%',
  maxWidth: '440px',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: '16px',
  padding: '1.75rem',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
  boxSizing: 'border-box'
};

const metricBoxStyle = {
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: '10px',
  padding: '0.75rem 0.5rem',
  textAlign: 'center'
};

const metricLabelStyle = {
  fontSize: '0.68rem',
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: '700'
};
