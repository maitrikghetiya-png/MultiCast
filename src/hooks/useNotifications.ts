import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppNotification, NotificationTone } from '../types/streaming.ts';

export interface NotifyOptions {
  tone?: NotificationTone;
  title: string;
  detail?: string;
  dedupeKey?: string;
  durationMs?: number;
}

const MAX_VISIBLE_NOTIFICATIONS = 4;

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const recentKeysRef = useRef<Map<string, number>>(new Map());
  const counterRef = useRef(0);

  const dismissNotification = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    ({ tone = 'info', title, detail, dedupeKey, durationMs }: NotifyOptions) => {
      const now = Date.now();
      if (dedupeKey) {
        const prevTs = recentKeysRef.current.get(dedupeKey);
        if (prevTs && now - prevTs < 1500) {
          return;
        }
        recentKeysRef.current.set(dedupeKey, now);
      }

      counterRef.current += 1;
      const id = `mc-toast-${now}-${counterRef.current}`;
      const item: AppNotification = {
        id,
        tone,
        title,
        detail,
        timestamp: now,
      };

      setNotifications((prev) => {
        const next = [item, ...prev];
        if (next.length > MAX_VISIBLE_NOTIFICATIONS) {
          const evicted = next.slice(MAX_VISIBLE_NOTIFICATIONS);
          for (const removed of evicted) {
            const t = timersRef.current.get(removed.id);
            if (t !== undefined) {
              window.clearTimeout(t);
              timersRef.current.delete(removed.id);
            }
          }
          return next.slice(0, MAX_VISIBLE_NOTIFICATIONS);
        }
        return next;
      });

      const resolvedDuration =
        durationMs ?? (tone === 'error' ? 7000 : tone === 'warning' ? 5500 : 4200);
      if (resolvedDuration > 0) {
        const timerId = window.setTimeout(() => {
          timersRef.current.delete(id);
          setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, resolvedDuration);
        timersRef.current.set(id, timerId);
      }
    },
    [],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return {
    notifications,
    notify,
    dismissNotification,
  };
}
