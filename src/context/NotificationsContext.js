import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { fetchNotifications } from '../services/videos';

const NotificationsContext = createContext({ unreadCount: 0, refreshUnread: async () => {} });

export const NotificationsProvider = ({ children }) => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(async () => {
    if (!user?.id) { setUnreadCount(0); return 0; }
    try {
      const list = await fetchNotifications(user.id, 80);
      const n = Array.isArray(list) ? list.filter((x) => !x.read).length : 0;
      setUnreadCount(n);
      return n;
    } catch {
      return 0;
    }
  }, [user?.id]);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  const value = useMemo(() => ({ unreadCount, setUnreadCount, refreshUnread }), [unreadCount, refreshUnread]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = () => useContext(NotificationsContext);
