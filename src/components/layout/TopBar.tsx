import { Check, Copy, User } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceRole } from '../../types/streaming.ts';
import { buildReceiverJoinUrl } from '../../utils/platform.ts';

interface TopBarProps {
  activeRole: WorkspaceRole;
  activeSessionCode: string | null;
  onQuickSwitchRole: (role: WorkspaceRole) => void;
  isAuthenticated: boolean;
  accountLabel?: string | null;
}

const ROLE_TITLES: Record<WorkspaceRole, string> = {
  landing: 'Home',
  broadcaster: 'Source Broadcaster',
  receiver: 'Receiver Display',
  guide: 'Network & Setup',
  auth: 'Account Sign In',
  profile: 'Account & Profile',
};

export function TopBar({
  activeRole,
  activeSessionCode,
  onQuickSwitchRole,
  isAuthenticated,
  accountLabel,
}: TopBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyReceiverLink = async () => {
    if (!activeSessionCode) return;
    try {
      await navigator.clipboard.writeText(buildReceiverJoinUrl(activeSessionCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be blocked in non-HTTPS contexts
    }
  };

  return (
    <header className="h-14 shrink-0 border-b border-zinc-200 bg-white text-zinc-900 px-5 sm:px-6 flex items-center justify-between gap-6">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <button
          type="button"
          onClick={() => onQuickSwitchRole('landing')}
          className="text-zinc-500 hover:text-red-600 transition-colors whitespace-nowrap"
        >
          MultiCast
        </button>
        <span className="text-zinc-300" aria-hidden="true">
          /
        </span>
        <h1 className="font-semibold text-zinc-900 whitespace-nowrap truncate">
          {ROLE_TITLES[activeRole]}
        </h1>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {activeSessionCode && activeRole === 'broadcaster' ? (
          <button
            type="button"
            onClick={() => void handleCopyReceiverLink()}
            className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:border-red-200 hover:bg-red-50/40 hover:text-red-700 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-red-600" />
            )}
            <span>{copied ? 'Copied' : 'Copy Link'}</span>
          </button>
        ) : activeRole !== 'receiver' ? (
          <button
            type="button"
            onClick={() => onQuickSwitchRole('receiver')}
            className="min-h-[40px] sm:min-h-0 inline-flex items-center px-3 sm:px-3.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:border-red-200 hover:bg-red-50/40 hover:text-red-700 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
          >
            Join Room
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onQuickSwitchRole('broadcaster')}
            className="min-h-[40px] sm:min-h-0 inline-flex items-center px-3 sm:px-3.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:border-red-200 hover:bg-red-50/40 hover:text-red-700 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
          >
            Source
          </button>
        )}

        {activeRole !== 'auth' && activeRole !== 'profile' ? (
          <button
            type="button"
            onClick={() => onQuickSwitchRole(isAuthenticated ? 'profile' : 'auth')}
            className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:border-zinc-300 transition-colors whitespace-nowrap shrink-0 max-w-[140px] sm:max-w-[160px] touch-manipulation"
          >
            <User className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span className="truncate">
              {isAuthenticated ? accountLabel || 'Profile' : 'Sign In'}
            </span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
