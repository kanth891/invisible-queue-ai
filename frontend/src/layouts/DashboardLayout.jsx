import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function DashboardLayout({ allowedRoles = [] }) {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) {
    return (
      <div className="app flex items-center justify-center h-screen">
        <div className="spinner" /> Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    // Redirect to their appropriate dashboard based on role
    switch (user.role) {
      case 'ADMIN': return <Navigate to="/admin" replace />;
      case 'RECEPTIONIST': return <Navigate to="/receptionist" replace />;
      case 'DOCTOR': return <Navigate to="/doctor" replace />;
      default: return <Navigate to="/login" replace />;
    }
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <div className="header__icon">🏥</div>
          <span className="header__title">Invisible Queue AI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className="header__badge">{user.role}</span>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{user.name}</span>
          <button onClick={handleLogout} style={{
            background: 'rgba(251, 113, 133, 0.1)',
            color: 'var(--accent-rose)',
            border: '1px solid rgba(251, 113, 133, 0.2)',
            padding: '0.4rem 0.8rem',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.85rem'
          }}>
            Logout
          </button>
        </div>
      </header>
      <main className="main" style={{ padding: '2rem 1.5rem', maxWidth: '1200px', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
}
