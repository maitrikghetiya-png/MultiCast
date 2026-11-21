import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { AppNotification, NotificationTone } from '../../types/streaming.ts';

interface NotificationCenterProps {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
}

const TONE_STYLES: Record<
  NotificationTone,
  { container: string; iconClass: string; titleClass: string; detailClass: string }
> = {
  info: {
    container: 'border-zinc-200 bg-white',
    iconClass: 'text-red-600',
    titleClass: 'text-zinc-900',
    detailClass: 'text-zinc-600',
  },
  success: {
    container: 'border-emerald-200 bg-white',
    iconClass: 'text-emerald-600',
    titleClass: 'text-zinc-900',
    detailClass: 'text-zinc-600',
  },
  warning: {
    container: 'border-amber-200 bg-amber-50',
    iconClass: 'text-amber-600',
    titleClass: 'text-amber-950',
    detailClass: 'text-amber-800',
  },
  error: {
    container: 'border-red-200 bg-red-50',
    iconClass: 'text-red-600',
    titleClass: 'text-red-950',
    detailClass: 'text-red-800',
  },
};

function renderToneIcon(tone: NotificationTone, className: string) {
  switch (tone) {
    case 'success':
      return <CheckCircle2 className={`h-4 w-4 shrink-0 ${className}`} />;
    case 'warning':
      return <AlertTriangle className={`h-4 w-4 shrink-0 ${className}`} />;
    case 'error':
      return <AlertCircle className={`h-4 w-4 shrink-0 ${className}`} />;
    default:
      return <Info className={`h-4 w-4 shrink-0 ${className}`} />;
  }
}

export function NotificationCenter({
  notifications,
  onDismiss,
}: NotificationCenterProps) {
  if (notifications.length === 0) return null;

  return (
    <aside
      aria-label="Notifications"
      aria-live="polite"
      className="fixed top-4 left-4 right-4 sm:left-auto z-50 flex flex-col gap-2 sm:w-full sm:max-w-sm pointer-events-none"
    >
      {notifications.map((item) => {
        const style = TONE_STYLES[item.tone];
        return (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-xl border shadow-lg shadow-zinc-900/5 px-3.5 py-2.5 flex items-start gap-2.5 ${style.container}`}
          >
            <div className="mt-0.5">{renderToneIcon(item.tone, style.iconClass)}</div>
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-semibold leading-snug ${style.titleClass}`}>
                {item.title}
              </div>
              {item.detail ? (
                <div className={`mt-0.5 text-[11px] leading-snug ${style.detailClass}`}>
                  {item.detail}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label="Dismiss notification"
              className="p-0.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </aside>
  );
}
