import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { CloseIcon } from '../components/Icons';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [browserPermission, setBrowserPermission] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });

  // Track sent notification keys to guarantee 100% idempotency / no spam
  const sentKeys = useRef(new Set());

  // Check browser permission status
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  const requestBrowserPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    try {
      const perm = await Notification.requestPermission();
      setBrowserPermission(perm);
      return perm;
    } catch (err) {
      console.warn('Browser notification permission request error:', err);
      return 'denied';
    }
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(
    ({ type = 'INFO', title, message, dedupeKey = null, duration = 8000 }) => {
      // Deduplication check
      if (dedupeKey) {
        if (sentKeys.current.has(dedupeKey)) {
          return null; // Already sent, skip to prevent notification spam
        }
        sentKeys.current.add(dedupeKey);
      }

      const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newNotif = { id, type, title, message, createdAt: new Date() };

      setNotifications((prev) => [newNotif, ...prev.slice(0, 4)]); // Keep max 5 active toasts

      // Browser Web Notification (if permission was granted)
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title || 'Invisible Queue AI', {
            body: message,
            icon: '/vite.svg',
            badge: '/vite.svg',
            tag: dedupeKey || id,
          });
        } catch (e) {
          // In case mobile browser blocks or requires service worker
        }
      }

      // Auto dismiss if duration > 0 (unless turn notification which should stay prominent)
      if (duration && type !== 'TURN') {
        setTimeout(() => {
          dismissNotification(id);
        }, duration);
      }

      return id;
    },
    [dismissNotification]
  );

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        notify,
        dismissNotification,
        browserPermission,
        requestBrowserPermission,
      }}
    >
      {children}
      {/* ── Fixed In-App Toast Container ── */}
      {notifications.length > 0 && (
        <div
          role="region"
          aria-label="Queue Notifications"
          style={{
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem',
            maxWidth: '380px',
            width: 'calc(100vw - 2rem)',
            pointerEvents: 'none',
          }}
        >
          {notifications.map((n) => {
            const isTurn = n.type === 'TURN';
            const isApproaching = n.type === 'APPROACHING';
            const bg = isTurn
              ? 'rgba(13, 27, 30, 0.94)'
              : isApproaching
              ? 'rgba(30, 24, 12, 0.94)'
              : 'rgba(13, 19, 34, 0.94)';
            const borderColor = isTurn ? '#06B6D4' : isApproaching ? '#F59E0B' : 'rgba(255, 255, 255, 0.12)';
            const accentGlow = isTurn
              ? '0 12px 36px rgba(0, 0, 0, 0.7), 0 0 20px rgba(6, 182, 212, 0.25)'
              : isApproaching
              ? '0 12px 36px rgba(0, 0, 0, 0.7), 0 0 20px rgba(245, 158, 11, 0.25)'
              : '0 12px 36px rgba(0, 0, 0, 0.7), 0 0 16px rgba(0, 0, 0, 0.4)';
            const titleColor = isTurn ? '#38BDF8' : isApproaching ? '#FBBF24' : '#F8FAFC';
            const textColor = '#CBD5E1';

            return (
              <div
                key={n.id}
                role="alert"
                aria-live="polite"
                style={{
                  pointerEvents: 'auto',
                  background: bg,
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: `1px solid ${borderColor}`,
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: '12px',
                  padding: '0.9rem 1.1rem',
                  boxShadow: accentGlow,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.85rem',
                  animation: 'slideInRight 0.25s ease-out',
                }}
              >
                <div>
                  {n.title && (
                    <div
                      style={{
                        fontSize: '0.88rem',
                        fontWeight: '700',
                        color: titleColor,
                        fontFamily: "'Outfit', sans-serif",
                        marginBottom: '0.2rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: borderColor,
                          display: 'inline-block',
                          boxShadow: `0 0 8px ${borderColor}`,
                        }}
                      />
                      <span>{n.title}</span>
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '0.82rem',
                      color: textColor,
                      lineHeight: '1.45',
                    }}
                  >
                    {n.message}
                  </div>
                </div>

                <button
                  onClick={() => dismissNotification(n.id)}
                  aria-label="Dismiss notification"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94A3B8',
                    cursor: 'pointer',
                    padding: '0.2rem 0.4rem',
                    borderRadius: '4px',
                    flexShrink: 0,
                    minHeight: '28px',
                    minWidth: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CloseIcon size={14} color="#94A3B8" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}

export default NotificationContext;
