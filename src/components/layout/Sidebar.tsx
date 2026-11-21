import { Cast, Home, Menu, Monitor, Network, Radio, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { SignalingConnectionState } from '../../services/socket/socketClient.ts';
import type { WorkspaceRole } from '../../types/streaming.ts';
import { detectBrowserName, detectDevicePlatform } from '../../utils/platform.ts';
import { BrandMark } from '../common/BrandMark.tsx';
import { StatusLabel } from '../common/StatusLabel.tsx';

interface SidebarProps {
  activeRole: WorkspaceRole;
  onSelectRole: (role: WorkspaceRole) => void;
  activeCode: string | null;
  totalDevices: number;
  maxTotalDevices: number;
  receiverCount: number;
  isStreaming: boolean;
  signalingState: SignalingConnectionState;
  isAuthenticated: boolean;
  accountLabel?: string | null;
}

export function Sidebar({
  activeRole,
  onSelectRole,
  activeCode,
  totalDevices,
  maxTotalDevices,
  receiverCount,
  isStreaming,
  signalingState,
  isAuthenticated,
  accountLabel,
}: SidebarProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const platform = detectDevicePlatform();
  const browser = detectBrowserName();

  const navItems: Array<{
    id: WorkspaceRole;
    label: string;
    description: string;
    icon: typeof Cast;
  }> = [
    {
      id: 'broadcaster',
      label: 'Source Broadcaster',
      description: 'Share screen & audio',
      icon: Cast,
    },
    {
      id: 'receiver',
      label: 'Receiver Display',
      description: 'Join & view a cast',
      icon: Monitor,
    },
    {
      id: 'guide',
      label: 'Network & Setup',
      description: 'LAN URLs & WebRTC info',
      icon: Network,
    },
    {
      id: isAuthenticated ? 'profile' : 'auth',
      label: isAuthenticated ? 'Account & Profile' : 'Sign In / Register',
      description: isAuthenticated
        ? accountLabel || 'Profile & recent rooms'
        : 'Required to host rooms',
      icon: UserCheck,
    },
  ];

  const handleSelect = (role: WorkspaceRole) => {
    setMobileNavOpen(false);
    onSelectRole(role);
  };

  return (
    <aside className="w-full lg:w-[264px] shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-200 bg-white text-zinc-900 flex flex-col justify-between">
      {/* Compact Mobile/Tablet Header (< lg) */}
      <div className="lg:hidden px-4 py-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => handleSelect('landing')}
          className="text-left hover:opacity-85 transition-opacity rounded-md shrink-0"
        >
          <BrandMark />
        </button>

        <div className="flex items-center gap-2">
          {activeCode ? (
            <span className="font-mono text-xs font-semibold text-zinc-800 px-2.5 py-1 rounded-md border border-zinc-200 bg-zinc-50 tabular-nums">
              {activeCode} · {totalDevices}/{maxTotalDevices}
            </span>
          ) : (
            <StatusLabel status={signalingState} />
          )}

          <button
            type="button"
            onClick={() => setMobileNavOpen((prev) => !prev)}
            aria-label={mobileNavOpen ? 'Close workspace navigation' : 'Open workspace navigation'}
            aria-expanded={mobileNavOpen}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors touch-manipulation"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expandable Mobile/Tablet Navigation Drawer */}
      {mobileNavOpen ? (
        <div className="lg:hidden border-t border-zinc-200 px-4 py-3 space-y-1.5 bg-white">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeRole === item.id ||
              (item.id === 'profile' && activeRole === 'auth') ||
              (item.id === 'auth' && activeRole === 'profile');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors touch-manipulation ${
                  isActive
                    ? 'bg-red-50 text-red-700'
                    : 'text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-red-600' : 'text-zinc-500'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">
                    {item.label}
                  </span>
                  <span
                    className={`block text-xs truncate ${
                      isActive ? 'text-red-600/80' : 'text-zinc-500'
                    }`}
                  >
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="pt-2 border-t border-zinc-200 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {platform} <span aria-hidden="true">·</span> {browser}
            </span>
            <button
              type="button"
              onClick={() => handleSelect('landing')}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2 text-xs font-medium text-zinc-700 hover:text-red-600"
            >
              <Home className="h-3.5 w-3.5" />
              <span>Home</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Full Desktop Sidebar (lg+) */}
      <div className="hidden lg:block p-5">
        <div className="pb-5 border-b border-zinc-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectRole('landing')}
            className="text-left hover:opacity-85 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600 rounded-md"
          >
            <BrandMark />
          </button>
          <button
            type="button"
            onClick={() => onSelectRole('landing')}
            aria-label="Back to home page"
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            <Home className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-5 space-y-1" aria-label="Workspace roles">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeRole === item.id ||
              (item.id === 'profile' && activeRole === 'auth') ||
              (item.id === 'auth' && activeRole === 'profile');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectRole(item.id)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                  isActive
                    ? 'bg-red-50 text-red-700'
                    : 'text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 mt-0.5 shrink-0 ${
                    isActive ? 'text-red-600' : 'text-zinc-500'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold whitespace-nowrap truncate">
                    {item.label}
                  </span>
                  <span
                    className={`block text-xs truncate ${
                      isActive ? 'text-red-600/80' : 'text-zinc-500'
                    }`}
                  >
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        {activeCode ? (
          <div className="mt-6 pt-5 border-t border-zinc-200 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Room Code</span>
              <span className="font-mono font-semibold tabular-nums text-zinc-900">
                {activeCode}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Room Devices</span>
              <span className="font-mono font-semibold tabular-nums text-zinc-900">
                {totalDevices} / {maxTotalDevices}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Receivers</span>
              <span className="font-mono font-semibold tabular-nums text-zinc-900">
                {receiverCount}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Stream Feed</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-900">
                <Radio
                  className={`h-3.5 w-3.5 ${
                    isStreaming ? 'text-red-600' : 'text-zinc-400'
                  }`}
                />
                {isStreaming ? 'Live' : 'Standby'}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden lg:block p-5 border-t border-zinc-200 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Connection Status</span>
          <StatusLabel status={signalingState} />
        </div>
        <div className="text-xs text-zinc-500 truncate">
          {platform} <span aria-hidden="true">·</span> {browser}
        </div>
        <div className="pt-1 text-[11px] text-zinc-400">
          Made by Maitrik Ghetiya
        </div>
      </div>
    </aside>
  );
}
