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
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1rem', boxSizing: 'border-box' }}>
      <div
        className="card"
        style={{
          maxWidth: '420px',
          width: '100%',
          padding: 'clamp(1.25rem, 5vw, 2rem)',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03)',
          boxSizing: 'border-box'
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'var(--primary-teal, #0D9488)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 0.75rem',
              boxShadow: '0 4px 12px rgba(13, 148, 136, 0.25)'
            }}
          >
            <MedicalCrossIcon size={24} color="#FFFFFF" />
          </div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0F5147', marginBottom: '0.25rem' }}>
            Invisible Queue AI
          </h1>
          <p style={{ color: '#64748B', fontSize: '0.82rem' }}>
            Hospital Staff & Clinical Administration Portal
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              background: '#FEE2E2',
              color: '#991B1B',
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
            <AlertTriangleIcon size={16} color="#DC2626" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.45rem',
                fontSize: '0.85rem',
                fontWeight: '600',
                color: 'var(--text-primary, #1E293B)'
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
                fontSize: '0.85rem',
                fontWeight: '600',
                color: 'var(--text-primary, #1E293B)'
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
        <div style={{ marginTop: '1.75rem', borderTop: '1px solid var(--border-subtle, #E2E8F0)', paddingTop: '1.15rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary, #64748B)', textAlign: 'center', marginBottom: '0.65rem' }}>
            Quick Demo Logins (Click to Autofill)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => handleDemoFill('receptionist1@hospital.com', 'recep123')}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.55rem 0.85rem', minHeight: '44px', flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem', width: '100%' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '600' }}>
                <UserIcon size={14} color="#0D9488" /> Receptionist
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>receptionist1@hospital.com</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoFill('dr.ravi@hospital.com', 'doctor123')}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.55rem 0.85rem', minHeight: '44px', flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem', width: '100%' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '600' }}>
                <StethoscopeIcon size={14} color="#0D9488" /> Doctor (General Medicine)
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>dr.ravi@hospital.com</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoFill('admin@hospital.com', 'admin123')}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.55rem 0.85rem', minHeight: '44px', flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem', width: '100%' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: '600' }}>
                <ShieldCheckIcon size={14} color="#0D9488" /> Administrator
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>admin@hospital.com</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
