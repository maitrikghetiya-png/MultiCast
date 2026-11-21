import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthPage } from './components/auth/AuthPage.tsx';
import { ProfilePage } from './components/auth/ProfilePage.tsx';
import { BroadcasterWorkspace } from './components/broadcaster/BroadcasterWorkspace.tsx';
import { NotificationCenter } from './components/common/NotificationCenter.tsx';
import { NetworkGuide } from './components/guide/NetworkGuide.tsx';
import { LandingPage } from './components/landing/LandingPage.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { TopBar } from './components/layout/TopBar.tsx';
import { ReceiverWorkspace } from './components/receiver/ReceiverWorkspace.tsx';
import { TvReceiverWorkspace } from './components/receiver/TvReceiverWorkspace.tsx';
import { useAuth } from './contexts/AuthContext.tsx';
import { useBroadcaster } from './hooks/useBroadcaster.ts';
import { useNotifications } from './hooks/useNotifications.ts';
import { useReceiver } from './hooks/useReceiver.ts';
import { socketClient } from './services/socket/socketClient.ts';
import type { WorkspaceRole } from './types/streaming.ts';

const ROLE_TO_PATH: Record<WorkspaceRole, string> = {
  landing: '/',
  broadcaster: '/cast',
  receiver: '/join',
  guide: '/network',
  auth: '/auth',
  profile: '/profile',
};

function parseRouteFromLocation(): {
  role: WorkspaceRole;
  code: string;
  resetOobCode: string | null;
} {
  if (typeof window === 'undefined') {
    return { role: 'landing', code: '', resetOobCode: null };
  }

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  const code = (params.get('code') || params.get('room') || '').trim().toUpperCase();

  if (mode === 'resetPassword' && oobCode) {
    return { role: 'auth', code: '', resetOobCode: oobCode };
  }
  if (pathname === '/tv') {
    return { role: 'landing', code, resetOobCode: null };
  }
  if (pathname === '/cast' || mode === 'broadcaster') {
    return { role: 'broadcaster', code: '', resetOobCode: null };
  }
  if (pathname === '/join' || pathname === '/receive' || mode === 'receiver') {
    return { role: 'receiver', code, resetOobCode: null };
  }
  if (pathname === '/network' || mode === 'guide') {
    return { role: 'guide', code: '', resetOobCode: null };
  }
  if (pathname === '/auth' || pathname === '/login' || pathname === '/register') {
    return { role: 'auth', code: '', resetOobCode: null };
  }
  if (pathname === '/profile' || pathname === '/account') {
    return { role: 'profile', code: '', resetOobCode: null };
  }
  return { role: 'landing', code: '', resetOobCode: null };
}

export default function App() {
  const initial = parseRouteFromLocation();
  const [activeRole, setActiveRole] = useState<WorkspaceRole>(initial.role);
  const [initialCode, setInitialCode] = useState<string>(initial.code);
  const [isTvMode, setIsTvMode] = useState(
    () => typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/tv',
  );
  const [resetOobCode, setResetOobCode] = useState<string | null>(initial.resetOobCode);
  const [pendingProtectedRole, setPendingProtectedRole] = useState<WorkspaceRole | null>(
    null,
  );
  const lastRouteRef = useRef(
    typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/',
  );

  const { user, profile, authLoading, isVerifiedUser, serverLimits } = useAuth();
  const { notifications, notify, dismissNotification } = useNotifications();
  const broadcaster = useBroadcaster(notify);
  const receiver = useReceiver(notify);

  useEffect(() => {
    socketClient.connect();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = `${window.location.pathname}${window.location.search}`;
      if (
        nextPath !== lastRouteRef.current &&
        broadcaster.captureSupport.platform === 'Android' &&
        broadcaster.localStream?.getVideoTracks().some((track) => track.readyState === 'live')
      ) {
        const shouldStopAndLeave = window.confirm(
          'Android screen broadcasting is active. Stop broadcasting before leaving this page?',
        );
        if (!shouldStopAndLeave) {
          window.history.pushState({}, '', lastRouteRef.current);
          return;
        }
        broadcaster.stopScreenCast('Android broadcaster left the source page.');
      }

      lastRouteRef.current = nextPath;
      const parsed = parseRouteFromLocation();
      setActiveRole(parsed.role);
      setInitialCode(parsed.code);
      setResetOobCode(parsed.resetOobCode);
      setIsTvMode(window.location.pathname.replace(/\/+$/, '') === '/tv');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    activeRole,
    broadcaster.captureSupport.platform,
    broadcaster.localStream,
    broadcaster.stopScreenCast,
  ]);

  const navigateToRole = useCallback((role: WorkspaceRole) => {
    if (
      role !== activeRole &&
      broadcaster.captureSupport.platform === 'Android' &&
      broadcaster.localStream?.getVideoTracks().some((track) => track.readyState === 'live')
    ) {
      const shouldStopAndLeave = window.confirm(
        'Android screen broadcasting is active. Stop broadcasting before leaving this page?',
      );
      if (!shouldStopAndLeave) return;
      broadcaster.stopScreenCast('Android broadcaster left the source page.');
    }

    setIsTvMode(false);
    setActiveRole(role);
    if (role !== 'auth') {
      setResetOobCode(null);
      setPendingProtectedRole(role === 'broadcaster' || role === 'profile' ? role : null);
    }
    const targetPath = ROLE_TO_PATH[role];
    if (window.location.pathname !== targetPath || window.location.search) {
      window.history.pushState({}, '', targetPath);
      lastRouteRef.current = targetPath;
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [
    activeRole,
    broadcaster.captureSupport.platform,
    broadcaster.localStream,
    broadcaster.stopScreenCast,
  ]);

  const isAuthenticated = Boolean(user && isVerifiedUser);
  const accountLabel =
    profile?.displayName || user?.displayName || user?.email || user?.phoneNumber || null;

  if (isTvMode) {
    return (
      <TvReceiverWorkspace
        receiver={receiver}
        initialCode={initialCode}
        onExit={() => navigateToRole('receiver')}
      />
    );
  }

  if (activeRole === 'landing') {
    return (
      <>
        <LandingPage onNavigate={navigateToRole} isAuthenticated={isAuthenticated} />
        <NotificationCenter
          notifications={notifications}
          onDismiss={dismissNotification}
        />
      </>
    );
  }

  const activeSession =
    activeRole === 'receiver' ? receiver.session : broadcaster.session;

  const activeSignalingState =
    activeRole === 'receiver'
      ? receiver.signalingState
      : broadcaster.signalingState;

  const totalDevices = activeSession
    ? activeSession.totalDevices ?? activeSession.receivers.length + 1
    : 0;
  const maxTotalDevices = activeSession
    ? activeSession.maxTotalDevices ?? serverLimits.maxTotalDevicesPerRoom
    : serverLimits.maxTotalDevicesPerRoom;

  const requiresVerifiedAccount =
    activeRole === 'broadcaster' || activeRole === 'profile';
  const showAuthGate = requiresVerifiedAccount && !isAuthenticated;

  const authRedirectReason =
    activeRole === 'broadcaster'
      ? 'Sign in and verify your MultiCast account to create rooms and broadcast your screen.'
      : activeRole === 'profile'
        ? 'Sign in and verify your MultiCast account to manage your profile and recent rooms.'
        : null;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAFAFA] text-zinc-900">
      <Sidebar
        activeRole={activeRole}
        onSelectRole={navigateToRole}
        activeCode={activeSession?.code || null}
        totalDevices={totalDevices}
        maxTotalDevices={maxTotalDevices}
        receiverCount={activeSession?.receivers.length || 0}
        isStreaming={Boolean(
          activeRole === 'receiver'
            ? receiver.streamMetadata.active
            : broadcaster.streamMetadata.active,
        )}
        signalingState={activeSignalingState}
        isAuthenticated={isAuthenticated}
        accountLabel={accountLabel}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          activeRole={activeRole}
          activeSessionCode={broadcaster.session?.code || receiver.session?.code || null}
          onQuickSwitchRole={navigateToRole}
          isAuthenticated={isAuthenticated}
          accountLabel={accountLabel}
        />

        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {authLoading && requiresVerifiedAccount ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-600">
              Restoring your MultiCast session...
            </div>
          ) : activeRole === 'auth' || showAuthGate ? (
            <AuthPage
              resetOobCode={resetOobCode}
              redirectReason={authRedirectReason}
              onAuthenticated={() => {
                setResetOobCode(null);
                const target =
                  activeRole === 'auth'
                    ? pendingProtectedRole || 'broadcaster'
                    : activeRole;
                setPendingProtectedRole(null);
                navigateToRole(target);
              }}
              onCancel={() => navigateToRole('landing')}
            />
          ) : activeRole === 'profile' ? (
            <ProfilePage
              onStartSharing={() => navigateToRole('broadcaster')}
              onJoinRoomCode={(code) => {
                setInitialCode(code);
                navigateToRole('receiver');
              }}
            />
          ) : activeRole === 'broadcaster' ? (
            <BroadcasterWorkspace
              broadcaster={broadcaster}
              onSwitchToReceiver={() => navigateToRole('receiver')}
            />
          ) : activeRole === 'receiver' ? (
            <ReceiverWorkspace
              receiver={receiver}
              initialCode={initialCode}
            />
          ) : (
            <NetworkGuide />
          )}
        </main>
      </div>

      <NotificationCenter
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
