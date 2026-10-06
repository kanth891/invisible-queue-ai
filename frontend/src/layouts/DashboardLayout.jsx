import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function DashboardLayout({ allowedRoles = [] }) {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="spinner" />
        <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>Loading Invisible Queue...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
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
      {/* Top Navigation Bar: Minimal, Clean, Light */}
      <header className="header">
        <div className="header__brand">
          <div className="header__icon">🏥</div>
          <div>
            <div className="header__title">Invisible Queue AI</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '500' }}>
              Smart Healthcare Platform
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary)' }}>
              {user.name}
            </span>
            <span className="header__badge">
              {user.role}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="btn-secondary"
            style={{
              padding: '0.45rem 0.9rem',
              fontSize: '0.82rem',
              borderRadius: '8px'
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Page Content */}
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
