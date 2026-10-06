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
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app flex items-center justify-center min-h-screen">
      <div className="status-card" style={{ maxWidth: '400px', width: '100%', flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="header__icon" style={{ margin: '0 auto 1rem' }}>🏥</div>
          <h2 className="header__title">Invisible Queue AI</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Hospital Queue Foundation (Phase 1)
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(251, 113, 133, 0.1)', color: 'var(--accent-rose)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.9rem', border: '1px solid rgba(251, 113, 133, 0.2)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'white' }}
              placeholder="admin@hospital.com"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'white' }}
              placeholder="••••••••"
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            style={{ 
              marginTop: '1rem',
              padding: '0.75rem', 
              background: 'var(--gradient-primary)', 
              color: 'white', 
              border: 'none', 
              borderRadius: 'var(--radius-sm)',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? <><span className="spinner" style={{ width: '12px', height: '12px' }}/> Authenticating...</> : 'Login'}
          </button>
        </form>

        <div style={{ marginTop: '2rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          <p>Demo Accounts:</p>
          <p>admin@hospital.com / admin123</p>
          <p>receptionist1@hospital.com / recep123</p>
          <p>dr.ravi@hospital.com / doctor123</p>
        </div>
      </div>
    </div>
  );
}
