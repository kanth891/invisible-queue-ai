import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { queueAPI } from '../../services/api';
import { MedicalCrossIcon, SearchIcon, StethoscopeIcon, CheckCircleIcon, ClockIcon, PulseIcon } from '../../components/Icons';

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
      <div style={containerStyle}>
        <div style={{ ...cardStyle, border: '1px solid #FECACA' }}>
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
              <SearchIcon size={32} color="#EF4444" />
            </div>
            <h2 style={{ color: '#EF4444', fontSize: '1.2rem', fontWeight: '700', marginBottom: '0.4rem' }}>
              Digital Pass Not Found
            </h2>
            <p style={{ color: '#64748B', fontSize: '0.85rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              {error}. Please check your token receipt slip or visit the hospital reception desk.
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
      {/* Hospital Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
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
              justifyContent: 'center'
            }}
          >
            <MedicalCrossIcon size={15} color="#FFFFFF" />
          </div>
          <span style={{ fontSize: '1.05rem', fontWeight: '800', letterSpacing: '-0.01em', color: '#0F5147' }}>
            Invisible Queue AI
          </span>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748B', letterSpacing: '0.02em', textTransform: 'uppercase', fontWeight: '500' }}>
          Outpatient Digital Pass
        </div>
      </div>

      {/* Main Clinical Pass Card */}
      <div style={cardStyle}>
        
        {/* Pass Header & Token Section */}
        <div
          style={{
            textAlign: 'center',
            paddingBottom: '1.25rem',
            borderBottom: '1px solid #E2E8F0',
            background: '#F8FAFC',
            margin: '-1.5rem -1.5rem 1.25rem -1.5rem',
            padding: '1.5rem 1.25rem 1.25rem 1.25rem',
            borderTopLeftRadius: '10px',
            borderTopRightRadius: '10px'
          }}
        >
          <div style={{ fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748B', fontWeight: '600' }}>
            Outpatient Token
          </div>
          <div
            style={{
              fontSize: '3.5rem',
              fontWeight: '900',
              letterSpacing: '0.02em',
              color: '#0F5147',
              lineHeight: 1.05,
              margin: '0.2rem 0',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {data.token}
          </div>
          <div style={{ fontSize: '1rem', fontWeight: '700', color: '#0F172A', marginTop: '0.35rem' }}>
            {data.doctor}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#0284C7', fontWeight: '500' }}>
            {data.department}
          </div>
        </div>

        {/* ── Clinical Alerts & Status ── */}

        {/* 1. YOUR TURN (Called) - Clinical Direct Notice */}
        {isCalled && (
          <div
            style={{
              background: '#F0FDFA',
              border: '1px solid #99F6E4',
              borderLeft: '4px solid #0D9488',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1.25rem',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0F5147', marginBottom: '0.2rem', letterSpacing: '0.02em' }}>
              YOUR TURN NOW
            </div>
            <div style={{ fontSize: '0.82rem', color: '#0F766E', lineHeight: 1.4 }}>
              The doctor is ready for you. Please proceed to the consultation room immediately.
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
              padding: '0.9rem 1rem',
              marginBottom: '1.25rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.9rem', fontWeight: '700', color: '#92400E', marginBottom: '0.2rem' }}>
              <span className="status-dot status-dot--waiting" />
              <span>Your turn is approaching</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#78350F', lineHeight: 1.4 }}>
              You are next in queue. Please make your way back towards the consultation area.
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
              padding: '0.85rem 1rem',
              marginBottom: '1.25rem',
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
              padding: '1rem',
              marginBottom: '1.25rem',
              textAlign: 'center'
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.95rem', fontWeight: '700', color: '#166534', marginBottom: '0.2rem' }}>
              <CheckCircleIcon size={16} color="#166534" />
              <span>Consultation Completed</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#166534' }}>
              Thank you for visiting today. Wishing you a swift recovery!
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
              padding: '0.45rem 0.85rem',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              marginBottom: '1.25rem',
              fontSize: '0.82rem',
              fontWeight: '500',
              color: '#334155'
            }}
          >
            <span className="status-dot status-dot--waiting" />
            <span>Waiting in Queue — Position #{data.position ?? 1}</span>
          </div>
        )}

        {/* ── Key Metrics Grid (Apollo-Style Clean Numbers) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.65rem',
            marginBottom: '1.25rem'
          }}
        >
          {/* Currently Serving */}
          <div style={metricBoxStyle}>
            <div style={metricLabelStyle}>Currently Serving</div>
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: data.currentToken ? '#0D9488' : '#94A3B8',
                marginTop: '0.2rem',
                fontVariantNumeric: 'tabular-nums'
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
                fontSize: '1.25rem',
                fontWeight: '700',
                color: data.position !== null ? '#0F172A' : '#94A3B8',
                marginTop: '0.2rem',
                fontVariantNumeric: 'tabular-nums'
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
                fontSize: '1.25rem',
                fontWeight: '700',
                color: data.patientsAhead > 0 ? '#D97706' : '#10B981',
                marginTop: '0.2rem',
                fontVariantNumeric: 'tabular-nums'
              }}
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
              <strong style={{ color: '#0F172A' }}>Remote Waiting Active.</strong> You are not required to remain in the waiting room. Feel free to visit the cafe, pharmacy, or lobby. This pass updates automatically.
            </div>
          </div>
        )}

        {/* Estimated Wait Time Box (Phase 3 Intelligent Prediction) */}
        {data.status === 'WAITING' && (
          <div
            style={{
              background: '#F0FDFA',
              border: '1px solid #99F6E4',
              borderRadius: '8px',
              padding: '0.9rem 1rem',
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
              <span>Estimated Wait Time</span>
            </div>

            {refreshing && !data.prediction ? (
              <div style={{ fontSize: '0.85rem', color: '#64748B', margin: '0.45rem 0', fontWeight: '500' }}>
                Calculating estimated wait...
              </div>
            ) : data.patientsAhead === 0 ? (
              <div style={{ margin: '0.35rem 0' }}>
                <div style={{ fontSize: '1.75rem', fontWeight: '900', color: '#0F5147', lineHeight: 1.1 }}>
                  ~2 min
                </div>
                <div style={{ fontSize: '0.78rem', color: '#0D9488', fontWeight: '600', marginTop: '0.15rem' }}>
                  You are next in line — please be prepared
                </div>
              </div>
            ) : data.prediction && data.prediction.lower_bound_minutes ? (
              <div style={{ margin: '0.35rem 0' }}>
                <div
                  style={{
                    fontSize: '1.85rem',
                    fontWeight: '900',
                    color: '#0F5147',
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {data.prediction.lower_bound_minutes}–{data.prediction.upper_bound_minutes} min
                </div>
                <div style={{ fontSize: '0.76rem', color: '#0F766E', marginTop: '0.2rem', fontWeight: '500' }}>
                  {data.prediction.message || 'Estimated wait based on current queue'}
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
                  <span>Model: {data.prediction.is_fallback ? 'Historical Baseline' : 'AI Gradient Boosting'}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: '#64748B', margin: '0.4rem 0' }}>
                Estimated wait unavailable — We're still learning from queue data.
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
            color: '#64748B'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: refreshing ? '#F59E0B' : '#10B981'
              }}
            />
            <span>{refreshing ? 'Updating live...' : 'Live sync connected'}</span>
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
              fontSize: '0.72rem',
              fontWeight: '600',
              padding: '0.2rem 0.4rem'
            }}
          >
            {refreshing ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>

      </div>

      {/* Safety notice */}
      <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.72rem', color: '#94A3B8' }}>
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
  backgroundColor: '#F8FAFC',
  boxSizing: 'border-box'
};

const cardStyle = {
  width: '100%',
  maxWidth: '420px',
  background: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: '10px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
  boxSizing: 'border-box'
};

const metricBoxStyle = {
  background: '#F8FAFC',
  border: '1px solid #E2E8F0',
  borderRadius: '6px',
  padding: '0.65rem 0.5rem',
  textAlign: 'center'
};

const metricLabelStyle = {
  fontSize: '0.65rem',
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: '600'
};
