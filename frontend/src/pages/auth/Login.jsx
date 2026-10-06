import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

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
    <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '1.5rem' }}>
      <div
        className="card"
        style={{
          maxWidth: '420px',
          width: '100%',
          padding: '2.25rem 2rem',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03)'
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'var(--primary-teal, #0D9488)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              margin: '0 auto 1rem',
              boxShadow: '0 4px 12px rgba(13, 148, 136, 0.25)'
            }}
          >
            🏥
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary, #1E293B)', marginBottom: '0.35rem' }}>
            Invisible Queue AI
          </h1>
          <p style={{ color: 'var(--text-secondary, #64748B)', fontSize: '0.88rem' }}>
            Smart Hospital Queue Management System
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
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
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
              padding: '0.75rem',
              marginTop: '0.5rem',
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
        <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border-subtle, #E2E8F0)', paddingTop: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary, #64748B)', textAlign: 'center', marginBottom: '0.75rem' }}>
            Quick Demo Logins (Click to Autofill)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => handleDemoFill('receptionist1@hospital.com', 'recep123')}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.45rem 0.75rem', justifyContent: 'space-between' }}
            >
              <span>👩‍💼 Receptionist</span>
              <span style={{ color: 'var(--text-muted)' }}>receptionist1@hospital.com</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoFill('dr.ravi@hospital.com', 'doctor123')}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.45rem 0.75rem', justifyContent: 'space-between' }}
            >
              <span>👨‍⚕️ Doctor (General Medicine)</span>
              <span style={{ color: 'var(--text-muted)' }}>dr.ravi@hospital.com</span>
            </button>
            <button
              type="button"
              onClick={() => handleDemoFill('admin@hospital.com', 'admin123')}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.45rem 0.75rem', justifyContent: 'space-between' }}
            >
              <span>⚙️ Administrator</span>
              <span style={{ color: 'var(--text-muted)' }}>admin@hospital.com</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
