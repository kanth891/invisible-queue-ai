import { useState, useEffect } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || '';

function StatusCard({ icon, label, ok, loading }) {
  const cls = loading ? 'loading' : ok ? 'success' : 'error';
  return (
    <div className="status-card">
      <div className={`status-card__icon-wrap status-card__icon-wrap--${cls}`}>{icon}</div>
      <div className="status-card__content">
        <div className="status-card__label">{label}</div>
        <div className={`status-card__value status-card__value--${cls}`}>
          {loading ? <><span className="spinner" />Checking…</> : ok ? '✓ Connected' : '✗ Unreachable'}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        setLoading(true);
        setHealth(await (await fetch(`${API_URL}/api/health`)).json());
      } catch {
        setHealth(null);
      } finally {
        setLoading(false);
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  const backendOk = !loading && health;
  const dbOk = backendOk && health?.services?.database === 'connected';

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <div className="header__icon">🏥</div>
          <span className="header__title">Invisible Queue AI</span>
        </div>
        <span className="header__badge">Infrastructure</span>
      </header>

      <main className="main">
        <section className="hero">
          <h1 className="hero__title">Invisible Queue AI</h1>
          <p className="hero__subtitle">
            Smart AI-powered hospital queue management. Infrastructure status — verifying all services are operational.
          </p>
        </section>

        <section className="status-section">
          <h2 className="status-section__title">Service Status</h2>
          <div className="status-grid">
            <div className="status-card">
              <div className="status-card__icon-wrap status-card__icon-wrap--success">⚛️</div>
              <div className="status-card__content">
                <div className="status-card__label">Frontend</div>
                <div className="status-card__value status-card__value--success">✓ Running</div>
              </div>
            </div>
            <StatusCard icon="🚀" label="Backend API" ok={backendOk} loading={loading} />
            <StatusCard icon="🗄️" label="PostgreSQL Database" ok={dbOk} loading={loading} />
          </div>
        </section>

        <section className="info-panel">
          <div className="info-panel__card">
            <h3 className="info-panel__title">🗺️ Development Roadmap</h3>
            <div className="info-panel__phases">
              {['Queue Foundation', 'Invisible Queue', 'AI Prediction', 'Real-Time Analytics'].map((p, i) => (
                <div key={i} className="phase-item">
                  <div className="phase-item__number">{i + 1}</div>
                  <span className="phase-item__text">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        Invisible Queue AI &middot; B.Tech CSE Final Year Project &middot; {new Date().getFullYear()}
      </footer>
    </div>
  );
}
