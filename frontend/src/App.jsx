import { useState, useEffect } from 'react';
import './App.css';

/**
 * API base URL — uses Vite proxy in dev, environment variable in production.
 */
const API_URL = import.meta.env.VITE_API_URL || '';

function App() {
  const [healthStatus, setHealthStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/api/health`);
        const data = await response.json();
        setHealthStatus(data);
        setError(null);
      } catch (err) {
        setError('Backend API is not reachable');
        setHealthStatus(null);
      } finally {
        setLoading(false);
      }
    };

    checkHealth();

    // Poll health every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (isConnected) => {
    if (loading) return '⏳';
    return isConnected ? '✓' : '✗';
  };

  const getStatusClass = (isConnected) => {
    if (loading) return 'loading';
    return isConnected ? 'success' : 'error';
  };

  const frontendOk = true;
  const backendOk = !loading && !error && healthStatus;
  const databaseOk = backendOk && healthStatus?.services?.database === 'connected';

  return (
    <div className="app">
      {/* ── Header ────────────────────────────────── */}
      <header className="header">
        <div className="header__brand">
          <div className="header__icon">🏥</div>
          <span className="header__title">Invisible Queue AI</span>
        </div>
        <span className="header__badge">Infrastructure</span>
      </header>

      {/* ── Main Content ──────────────────────────── */}
      <main className="main">
        {/* Hero */}
        <section className="hero">
          <h1 className="hero__title">Invisible Queue AI</h1>
          <p className="hero__subtitle">
            Smart AI-powered hospital queue management system.
            Infrastructure status dashboard — verifying all services are operational.
          </p>
        </section>

        {/* Status Grid */}
        <section className="status-section">
          <h2 className="status-section__title">Service Status</h2>
          <div className="status-grid">
            {/* Frontend */}
            <div className="status-card">
              <div className={`status-card__icon-wrap status-card__icon-wrap--success`}>
                ⚛️
              </div>
              <div className="status-card__content">
                <div className="status-card__label">Frontend</div>
                <div className={`status-card__value status-card__value--success`}>
                  ✓ Running
                </div>
              </div>
            </div>

            {/* Backend */}
            <div className="status-card">
              <div className={`status-card__icon-wrap status-card__icon-wrap--${getStatusClass(backendOk)}`}>
                🚀
              </div>
              <div className="status-card__content">
                <div className="status-card__label">Backend API</div>
                <div className={`status-card__value status-card__value--${getStatusClass(backendOk)}`}>
                  {loading ? (
                    <><span className="spinner"></span>Checking...</>
                  ) : backendOk ? (
                    '✓ Connected'
                  ) : (
                    '✗ Unreachable'
                  )}
                </div>
              </div>
            </div>

            {/* Database */}
            <div className="status-card">
              <div className={`status-card__icon-wrap status-card__icon-wrap--${getStatusClass(databaseOk)}`}>
                🗄️
              </div>
              <div className="status-card__content">
                <div className="status-card__label">PostgreSQL Database</div>
                <div className={`status-card__value status-card__value--${getStatusClass(databaseOk)}`}>
                  {loading ? (
                    <><span className="spinner"></span>Checking...</>
                  ) : databaseOk ? (
                    '✓ Connected'
                  ) : (
                    '✗ Disconnected'
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Server Info */}
        {healthStatus && (
          <section className="info-panel" style={{ marginTop: '1.5rem' }}>
            <div className="info-panel__card">
              <h3 className="info-panel__title">📊 Server Details</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem'
              }}>
                <div className="phase-item">
                  <div className="phase-item__number" style={{
                    background: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
                    fontSize: '0.7rem'
                  }}>ENV</div>
                  <span className="phase-item__text">{healthStatus.environment}</span>
                </div>
                <div className="phase-item">
                  <div className="phase-item__number" style={{
                    background: 'linear-gradient(135deg, #34d399, #10b981)',
                    fontSize: '0.7rem'
                  }}>UP</div>
                  <span className="phase-item__text">
                    {Math.floor(healthStatus.uptime)}s uptime
                  </span>
                </div>
                <div className="phase-item">
                  <div className="phase-item__number" style={{
                    background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
                    fontSize: '0.55rem'
                  }}>DB</div>
                  <span className="phase-item__text">{healthStatus.services?.database}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Development Phases */}
        <section className="info-panel">
          <div className="info-panel__card">
            <h3 className="info-panel__title">🗺️ Development Roadmap</h3>
            <div className="info-panel__phases">
              <div className="phase-item">
                <div className="phase-item__number">1</div>
                <span className="phase-item__text">Queue Foundation</span>
              </div>
              <div className="phase-item">
                <div className="phase-item__number">2</div>
                <span className="phase-item__text">Invisible Queue</span>
              </div>
              <div className="phase-item">
                <div className="phase-item__number">3</div>
                <span className="phase-item__text">AI Prediction</span>
              </div>
              <div className="phase-item">
                <div className="phase-item__number">4</div>
                <span className="phase-item__text">Real-Time Analytics</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────── */}
      <footer className="footer">
        Invisible Queue AI &middot; B.Tech CSE Final Year Project &middot; {new Date().getFullYear()}
      </footer>
    </div>
  );
}

export default App;
