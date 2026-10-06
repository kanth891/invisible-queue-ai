import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { MedicalCrossIcon, AlertTriangleIcon, UserIcon, StethoscopeIcon, ShieldCheckIcon } from '../../components/Icons';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleDemoFill = (demoEmail, demoPassword) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      
      const from = location.state?.from?.pathname;
      if (from && from !== '/') {
        navigate(from, { replace: true });
      } else {
        switch (user.role) {
          case 'ADMIN': navigate('/admin', { replace: true }); break;
          case 'RECEPTIONIST': navigate('/receptionist', { replace: true }); break;
          case 'DOCTOR': navigate('/doctor', { replace: true }); break;
          default: navigate('/', { replace: true });
        }
      }
    } catch (err) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="app"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '1.25rem',
        boxSizing: 'border-box',
        backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(6, 182, 212, 0.12) 0%, transparent 55%), radial-gradient(circle at 85% 75%, rgba(139, 92, 246, 0.08) 0%, transparent 45%)'
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '430px',
          width: '100%',
          padding: 'clamp(1.5rem, 5vw, 2.25rem)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(6, 182, 212, 0.12)',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Luminous Top Accent Bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: 'var(--primary-gradient)'
          }}
        />

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'var(--primary-gradient)',
              color: '#041017',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.85rem',
              boxShadow: '0 0 24px rgba(6, 182, 212, 0.45)'
            }}
          >
            <MedicalCrossIcon size={26} color="#041017" />
          </div>
          <h1
            style={{
              fontSize: '1.45rem',
              fontWeight: '900',
              fontFamily: 'var(--font-heading)',
              background: 'linear-gradient(135deg, #FFFFFF 0%, #38BDF8 60%, #818CF8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              marginBottom: '0.3rem',
              letterSpacing: '-0.02em'
            }}
          >
            Invisible Queue AI
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
            Hospital Staff & Clinical Administration Portal
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.14)',
              color: '#F87171',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <AlertTriangleIcon size={16} color="#F87171" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.45rem',
                fontSize: '0.82rem',
                fontWeight: '700',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Email Address
            </label>
            <input
              type="email"
              className="input-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="e.g. receptionist1@hospital.com"
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.45rem',
                fontSize: '0.82rem',
                fontWeight: '700',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Password
            </label>
            <input
              type="password"
              className="input-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{
              width: '100%',
              minHeight: '46px',
              marginTop: '0.4rem',
              fontSize: '0.95rem'
            }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: '16px', height: '16px', borderTopColor: '#041017' }} />
                Signing In...
              </>
            ) : (
              'Sign In to Dashboard'
            )}
          </button>
        </form>

        {/* Quick Demo Credentials */}
        <div style={{ marginTop: '1.75rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '0.75rem' }}>
            Quick Demo Logins (Click to Autofill)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <button
              type="button"
              onClick={() => handleDemoFill('receptionist1@hospital.com', 'recep123')}
              className="btn-secondary"
              style={{
                fontSize: '0.78rem',
                padding: '0.60rem 0.90rem',
                minHeight: '44px',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.15rem',
                width: '100%',
                background: 'rgba(22, 32, 54, 0.6)'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                <UserIcon size={14} color="#06B6D4" /> Receptionist
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>receptionist1@hospital.com</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoFill('dr.ravi@hospital.com', 'doctor123')}
              className="btn-secondary"
              style={{
                fontSize: '0.78rem',
                padding: '0.60rem 0.90rem',
                minHeight: '44px',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.15rem',
                width: '100%',
                background: 'rgba(22, 32, 54, 0.6)'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                <StethoscopeIcon size={14} color="#10B981" /> Doctor (General Medicine)
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>dr.ravi@hospital.com</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoFill('admin@hospital.com', 'admin123')}
              className="btn-secondary"
              style={{
                fontSize: '0.78rem',
                padding: '0.60rem 0.90rem',
                minHeight: '44px',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.15rem',
                width: '100%',
                background: 'rgba(22, 32, 54, 0.6)'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                <ShieldCheckIcon size={14} color="#8B5CF6" /> Administrator
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>admin@hospital.com</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
