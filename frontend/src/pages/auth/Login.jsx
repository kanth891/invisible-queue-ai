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
        backgroundImage: 'radial-gradient(circle at 15% 15%, rgba(37, 99, 235, 0.06) 0%, transparent 45%), radial-gradient(circle at 85% 10%, rgba(14, 165, 233, 0.06) 0%, transparent 40%), radial-gradient(circle at 50% 90%, rgba(16, 185, 129, 0.04) 0%, transparent 50%)'
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '430px',
          width: '100%',
          padding: 'clamp(1.5rem, 5vw, 2.25rem)',
          boxShadow: '0 20px 45px -10px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.85)',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
          background: '#FFFFFF'
        }}
      >
        {/* Luminous Top Accent Bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'var(--primary-gradient)'
          }}
        />

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'var(--primary-gradient)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.85rem',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.3)'
            }}
          >
            <MedicalCrossIcon size={26} color="#FFFFFF" />
          </div>
          <h1
            style={{
              fontSize: '1.45rem',
              fontWeight: '900',
              fontFamily: 'var(--font-heading)',
              background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 60%, #2563EB 100%)',
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
              background: '#FEF2F2',
              color: '#B91C1C',
              border: '1px solid #FECACA',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <AlertTriangleIcon size={16} color="#B91C1C" />
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
                <span className="spinner" style={{ width: '16px', height: '16px', borderTopColor: '#FFFFFF' }} />
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
                background: '#F8FAFC',
                borderColor: '#E2E8F0'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                <UserIcon size={14} color="#2563EB" /> Receptionist
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
                background: '#F8FAFC',
                borderColor: '#E2E8F0'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                <StethoscopeIcon size={14} color="#059669" /> Doctor (General Medicine)
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
                background: '#F8FAFC',
                borderColor: '#E2E8F0'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                <ShieldCheckIcon size={14} color="#4F46E5" /> Administrator
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>admin@hospital.com</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
