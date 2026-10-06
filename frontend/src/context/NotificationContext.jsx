import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

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
            const bg = isTurn ? '#F0FDFA' : isApproaching ? '#FFFBEB' : '#FFFFFF';
            const borderColor = isTurn ? '#0D9488' : isApproaching ? '#F59E0B' : '#E2E8F0';
            const textColor = isTurn ? '#0F5147' : isApproaching ? '#92400E' : '#1E293B';

            return (
              <div
                key={n.id}
                role="alert"
                aria-live="polite"
                style={{
                  pointerEvents: 'auto',
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: '8px',
                  padding: '0.85rem 1rem',
                  boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.12), 0 2px 6px -1px rgba(15, 23, 42, 0.08)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  animation: 'slideInRight 0.25s ease-out',
                }}
              >
                <div>
                  {n.title && (
                    <div
                      style={{
                        fontSize: '0.88rem',
                        fontWeight: '700',
                        color: textColor,
                        marginBottom: '0.2rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: borderColor,
                          display: 'inline-block',
                        }}
                      />
                      <span>{n.title}</span>
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '0.82rem',
                      color: textColor,
                      lineHeight: '1.4',
                      opacity: 0.95,
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
                    fontSize: '1rem',
                    lineHeight: '1',
                    padding: '0.2rem 0.4rem',
                    borderRadius: '4px',
                    flexShrink: 0,
                    minHeight: '28px',
                    minWidth: '28px',
                  }}
                >
                  ✕
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
