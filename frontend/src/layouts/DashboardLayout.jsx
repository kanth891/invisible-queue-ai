import { useState, useEffect } from 'react';
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MedicalCrossIcon, MenuIcon, CloseIcon, LogOutIcon } from '../components/Icons';

export default function DashboardLayout({ allowedRoles = [] }) {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close drawer when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    setMobileMenuOpen(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="app">
      {/* Top Navigation Bar: Bright, Crisp, Luxury Frosted Glass */}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {/* Mobile Hamburger Button */}
          <div className="header__mobile-actions">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="header__hamburger-btn"
              aria-label="Open Navigation Menu"
              title="Open Navigation Menu"
            >
              <MenuIcon size={20} color="var(--primary-blue)" />
            </button>
          </div>

          {/* Brand Logo & Title */}
          <div className="header__brand">
            <div className="header__icon">
              <MedicalCrossIcon size={20} color="#FFFFFF" />
            </div>
            <div>
              <div className="header__title">Invisible Queue AI</div>
              <div className="header__subtitle">
                Smart Healthcare Platform
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="header__nav-desktop">
          <span style={{ fontSize: '0.84rem', fontWeight: '700', color: 'var(--primary-blue)', borderBottom: '2px solid var(--primary-blue)', paddingBottom: '0.25rem', cursor: 'pointer' }}>
            {user.role === 'RECEPTIONIST' ? 'Outpatient Queue & Intake' : user.role === 'DOCTOR' ? 'Clinical Consultation' : 'System Overview'}
          </span>
          <span style={{ fontSize: '0.84rem', fontWeight: '500', color: 'var(--text-secondary)', cursor: 'default' }}>
            {user.role === 'RECEPTIONIST' ? 'Daily Register' : user.role === 'DOCTOR' ? 'Patient Queue' : 'Departments & Staff'}
          </span>
        </nav>

        {/* Desktop User Info & Sign Out */}
        <div className="header__user-desktop">
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: '700', color: 'var(--text-primary)' }}>
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
              padding: '0.45rem 0.95rem',
              fontSize: '0.82rem',
              borderRadius: '0',
              minHeight: '36px'
            }}
          >
            Sign Out
          </button>
        </div>

        {/* Mobile Role Badge */}
        <div className="header__mobile-actions">
          <span className="header__badge" style={{ fontSize: '0.70rem', padding: '0.2rem 0.5rem' }}>
            {user.role}
          </span>
        </div>
      </header>

      {/* Slide-out Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <>
          <div
            className="mobile-drawer-overlay"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation Drawer">
            <div className="mobile-drawer__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div className="header__icon" style={{ width: '32px', height: '32px' }}>
                  <MedicalCrossIcon size={16} color="#FFFFFF" />
                </div>
                <span style={{ fontWeight: '800', fontFamily: 'var(--font-heading)', fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  Invisible Queue AI
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="mobile-drawer__close"
                aria-label="Close Navigation Menu"
              >
                <CloseIcon size={18} color="var(--text-secondary)" />
              </button>
            </div>

            {/* User profile inside drawer */}
            <div className="mobile-drawer__user-card">
              <div style={{ fontSize: '0.90rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {user.name}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.45rem' }}>
                {user.email}
              </div>
              <span className="header__badge">
                Role: {user.role}
              </span>
            </div>

            {/* Navigation items */}
            <div className="mobile-drawer__nav-list">
              <div style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.25rem', paddingLeft: '0.5rem' }}>
                Active Workspace
              </div>
              <div className="mobile-drawer__nav-item mobile-drawer__nav-item--active">
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary-blue)', display: 'inline-block', flexShrink: 0, boxShadow: '0 0 8px rgba(37, 99, 235, 0.4)' }} />
                <span>{user.role === 'RECEPTIONIST' ? 'Outpatient Queue & Intake' : user.role === 'DOCTOR' ? 'Clinical Consultation' : 'System Overview'}</span>
              </div>
              <div className="mobile-drawer__nav-item" style={{ opacity: 0.65 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid var(--text-muted)', display: 'inline-block', flexShrink: 0 }} />
                <span>{user.role === 'RECEPTIONIST' ? 'Daily Register' : user.role === 'DOCTOR' ? 'Patient Queue' : 'Departments & Staff'}</span>
              </div>
            </div>

            {/* Drawer footer with sign out */}
            <div className="mobile-drawer__footer">
              <button
                onClick={handleLogout}
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', color: '#DC2626', borderColor: '#FECACA' }}
              >
                <LogOutIcon size={16} color="#DC2626" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Main Page Content */}
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
