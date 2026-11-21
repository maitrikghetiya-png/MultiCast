import { useEffect, useState, type FormEvent } from 'react';
import {
  Cast,
  CheckCircle2,
  Clock,
  LogOut,
  Monitor,
  ShieldCheck,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { formatLifetimeDuration } from '../../utils/platform.ts';

interface ProfilePageProps {
  onStartSharing: () => void;
  onJoinRoomCode: (code: string) => void;
}

export function ProfilePage({ onStartSharing, onJoinRoomCode }: ProfilePageProps) {
  const {
    user,
    profile,
    recentRooms,
    isAdmin,
    isVerifiedUser,
    serverVerified,
    serverLimits,
    logout,
    updateUserProfile,
    deleteRecentRoom,
  } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [defaultDeviceName, setDefaultDeviceName] = useState(
    profile?.defaultDeviceName || '',
  );
  const [preferredRole, setPreferredRole] = useState<'broadcaster' | 'receiver'>(
    profile?.preferredRole || 'broadcaster',
  );
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setDefaultDeviceName(profile.defaultDeviceName || '');
      setPreferredRole(profile.preferredRole || 'broadcaster');
    }
  }, [profile]);

  if (!user) return null;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setIsSaving(true);
    try {
      await updateUserProfile({
        displayName,
        defaultDeviceName: defaultDeviceName || undefined,
        preferredRole,
      });
      setFeedback('Account preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5">
        <div className="flex items-center gap-4">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={profile?.displayName || user.displayName || 'Account'}
              className="h-14 w-14 rounded-xl border border-zinc-200 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-700">
              <UserIcon className="h-6 w-6" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-zinc-900">
                {profile?.displayName || user.displayName || 'MultiCast Account'}
              </h1>
              {isAdmin && (
                <span className="text-xs font-semibold text-[#D91B24]">
                  · Administrator
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500">
              {user.email || user.phoneNumber || 'Authenticated Member'}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isVerifiedUser ? 'Verified identity' : 'Pending verification'}
              </span>
              {serverVerified && (
                <span className="inline-flex items-center gap-1 text-zinc-600">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#D91B24]" />
                  Server ID token verified
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onStartSharing}
            className="inline-flex items-center gap-2 rounded-lg bg-[#D91B24] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#B8141C]"
          >
            <Cast className="h-4 w-4" />
            Open Broadcaster
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <form
          onSubmit={handleSave}
          className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 lg:col-span-3"
        >
          <h2 className="font-display text-base font-semibold text-zinc-900">
            Account & Device Defaults
          </h2>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {feedback && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {feedback}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-700">
              Display Name
            </label>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-hidden focus:border-[#D91B24]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700">
              Default Device Label
            </label>
            <input
              type="text"
              maxLength={64}
              value={defaultDeviceName}
              onChange={(e) => setDefaultDeviceName(e.target.value)}
              placeholder="Studio MacBook Pro"
              className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-hidden focus:border-[#D91B24]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700">
              Preferred Role
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPreferredRole('broadcaster')}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  preferredRole === 'broadcaster'
                    ? 'border-[#D91B24] bg-red-50/60 text-[#D91B24]'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                Broadcaster (Share)
              </button>
              <button
                type="button"
                onClick={() => setPreferredRole('receiver')}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  preferredRole === 'receiver'
                    ? 'border-[#D91B24] bg-red-50/60 text-[#D91B24]'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                Receiver (View)
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </form>

        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 lg:col-span-2">
          <h2 className="font-display text-base font-semibold text-zinc-900">
            Room Policy Limits
          </h2>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
              <dt className="text-zinc-500">Max devices per room</dt>
              <dd className="font-mono font-semibold text-zinc-900">
                {serverLimits.maxTotalDevicesPerRoom} (1 + {serverLimits.maxReceiversPerRoom})
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
              <dt className="text-zinc-500">Default max lifetime</dt>
              <dd className="font-mono font-semibold text-zinc-900">
                {formatLifetimeDuration(serverLimits.roomMaxLifetimeMs)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
              <dt className="text-zinc-500">Inactive cleanup TTL</dt>
              <dd className="font-mono font-semibold text-zinc-900">
                {Math.round(serverLimits.roomIdleTtlMs / 60000)}m idle
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-500">Lifetime override</dt>
              <dd className="font-medium text-zinc-900">
                {isAdmin ? 'Administrator (Unlimited)' : 'Standard'}
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-zinc-500">
            Active room codes live in server memory while running and are cleared safely if the server restarts.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-zinc-900">
            Recent Rooms
          </h2>
          <span className="text-xs text-zinc-500">
            PINs are never stored for security
          </span>
        </div>

        {recentRooms.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No recent rooms recorded yet. Rooms you create or join appear here for quick access.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-zinc-100">
            {recentRooms.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                    {item.role === 'broadcaster' ? (
                      <Cast className="h-4 w-4 text-[#D91B24]" />
                    ) : (
                      <Monitor className="h-4 w-4 text-zinc-700" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900">
                        {item.code}
                      </span>
                      <span className="text-xs text-zinc-500">
                        · {item.role === 'broadcaster' ? 'Hosted' : 'Joined'} ({item.hostName})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <Clock className="h-3 w-3" />
                      <span>{new Date(item.updatedAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onJoinRoomCode(item.code)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Open in Join
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteRecentRoom(item.id)}
                    aria-label={`Remove room ${item.code} from history`}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
