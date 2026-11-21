import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  RecaptchaVerifier,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { RecentRoomEntry } from '../types/streaming.ts';
import {
  firebaseAuth,
  firestoreDb,
  handleFirestoreError,
  OperationType,
} from '../services/firebase/firebaseClient.ts';
import { socketClient } from '../services/socket/socketClient.ts';

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  email?: string;
  phoneNumber?: string;
  photoURL?: string;
  preferredRole?: 'broadcaster' | 'receiver';
  defaultDeviceName?: string;
}

export interface ServerRoomLimits {
  maxReceiversPerRoom: number;
  maxTotalDevicesPerRoom: number;
  roomIdleTtlMs: number;
  roomMaxLifetimeMs: number;
}

export interface AuthContextValue {
  user: User | null;
  profile: UserProfileRecord | null;
  recentRooms: RecentRoomEntry[];
  authLoading: boolean;
  isVerifiedUser: boolean;
  isAdmin: boolean;
  providerId: string | null;
  serverVerified: boolean;
  serverLimits: ServerRoomLimits;
  pendingPhoneNumber: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  signInWithGoogle: () => Promise<void>;
  registerWithEmail: (displayName: string, email: string, password: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  sendPasswordReset: (email: string) => Promise<void>;
  confirmPasswordResetCode: (oobCode: string, newPassword: string) => Promise<void>;
  requestPhoneOtp: (phoneE164: string, recaptchaContainerId: string) => Promise<void>;
  confirmPhoneOtp: (otpCode: string) => Promise<void>;
  clearPendingPhoneOtp: () => void;
  logout: () => Promise<void>;
  updateUserProfile: (updates: {
    displayName?: string;
    preferredRole?: 'broadcaster' | 'receiver';
    defaultDeviceName?: string;
  }) => Promise<void>;
  recordRecentRoom: (entry: {
    code: string;
    role: 'broadcaster' | 'receiver';
    hostName: string;
    deviceName: string;
  }) => Promise<void>;
  deleteRecentRoom: (roomId: string) => Promise<void>;
}

const DEFAULT_ROOM_LIMITS: ServerRoomLimits = {
  maxReceiversPerRoom: 9,
  maxTotalDevicesPerRoom: 10,
  roomIdleTtlMs: 30 * 60 * 1000,
  roomMaxLifetimeMs: 24 * 60 * 60 * 1000,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function mapFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code || '';
  const msg = (err as { message?: string } | null)?.message || '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts detected. Wait a few minutes before trying again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in window was closed before completing authentication.';
    case 'auth/popup-blocked':
      return 'Pop-up was blocked by your browser. Allow pop-ups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Authentication settings. Add the current hostname in Firebase Console → Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'This sign-in provider is not enabled yet in Firebase Console → Authentication → Sign-in method.';
    case 'auth/billing-not-enabled':
      return 'SMS phone verification requires Firebase Blaze (pay-as-you-go) billing or a Firebase test phone number configured in Firebase Console.';
    case 'auth/invalid-phone-number':
      return 'Enter a valid international phone number with country code (e.g. +14155550100).';
    case 'auth/invalid-verification-code':
      return 'The verification code is incorrect. Check the SMS code and try again.';
    case 'auth/code-expired':
      return 'That SMS verification code expired. Request a new code.';
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'This password reset link is invalid or expired. Request a new reset email.';
    default:
      return msg || 'Authentication request failed. Please try again.';
  }
}

function checkIsVerifiedFirebaseUser(user: User | null): boolean {
  if (!user) return false;
  if (user.emailVerified) return true;
  const hasPhoneProvider =
    user.providerData.some((p) => p.providerId === 'phone') &&
    Boolean(user.phoneNumber);
  return hasPhoneProvider;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [recentRooms, setRecentRooms] = useState<RecentRoomEntry[]>([]);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [serverVerified, setServerVerified] = useState<boolean>(false);
  const [serverLimits, setServerLimits] = useState<ServerRoomLimits>(DEFAULT_ROOM_LIMITS);
  const [pendingPhoneNumber, setPendingPhoneNumber] = useState<string | null>(null);

  const phoneConfirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  const verifyWithBackend = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      socketClient.setFirebaseToken(null);
      setIsAdmin(false);
      setServerVerified(false);
      return;
    }

    try {
      const idToken = await currentUser.getIdToken();
      socketClient.setFirebaseToken(idToken);
      const res = await fetch('/api/auth/session', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          user?: { isAdmin?: boolean };
          roomLimits?: ServerRoomLimits;
        };
        setServerVerified(Boolean(data.ok));
        setIsAdmin(Boolean(data.user?.isAdmin));
        if (data.roomLimits) {
          setServerLimits(data.roomLimits);
        }
      } else {
        setServerVerified(false);
        setIsAdmin(false);
      }
    } catch {
      setServerVerified(false);
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            maxReceiversPerRoom?: number;
            maxTotalDevicesPerRoom?: number;
            roomIdleTtlMs?: number;
            roomMaxLifetimeMs?: number;
          } | null,
        ) => {
          if (!data) return;
          setServerLimits((prev) => ({
            maxReceiversPerRoom: data.maxReceiversPerRoom ?? prev.maxReceiversPerRoom,
            maxTotalDevicesPerRoom:
              data.maxTotalDevicesPerRoom ?? prev.maxTotalDevicesPerRoom,
            roomIdleTtlMs: data.roomIdleTtlMs ?? prev.roomIdleTtlMs,
            roomMaxLifetimeMs: data.roomMaxLifetimeMs ?? prev.roomMaxLifetimeMs,
          }));
        },
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      await verifyWithBackend(nextUser);
      setAuthLoading(false);
    });

    return () => {
      unsubscribe();
      if (recaptchaVerifierRef.current) {
        try {
          recaptchaVerifierRef.current.clear();
        } catch {
          // Ignore recaptcha cleanup error
        }
        recaptchaVerifierRef.current = null;
      }
    };
  }, [verifyWithBackend]);

  const isVerifiedUser = checkIsVerifiedFirebaseUser(user);

  // Sync verified user profile & recent rooms from Firestore
  useEffect(() => {
    if (!user || !isVerifiedUser) {
      setProfile(null);
      setRecentRooms([]);
      return;
    }

    const userDocRef = doc(firestoreDb, 'users', user.uid);
    let seededInitialProfile = false;

    const unsubProfile = onSnapshot(
      userDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<UserProfileRecord>;
          setProfile({
            uid: user.uid,
            displayName:
              data.displayName ||
              user.displayName ||
              user.email?.split('@')[0] ||
              user.phoneNumber ||
              'MultiCast User',
            email: data.email || user.email || undefined,
            phoneNumber: data.phoneNumber || user.phoneNumber || undefined,
            photoURL: data.photoURL || user.photoURL || undefined,
            preferredRole: data.preferredRole,
            defaultDeviceName: data.defaultDeviceName,
          });
        } else if (!seededInitialProfile) {
          seededInitialProfile = true;
          const fallbackName = (
            user.displayName ||
            user.email?.split('@')[0] ||
            user.phoneNumber ||
            'MultiCast User'
          ).slice(0, 80);

          const newProfilePayload: Record<string, unknown> = {
            uid: user.uid,
            displayName: fallbackName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (user.email) newProfilePayload.email = user.email;
          if (user.phoneNumber) newProfilePayload.phoneNumber = user.phoneNumber;
          if (user.photoURL) newProfilePayload.photoURL = user.photoURL;

          void setDoc(userDocRef, newProfilePayload).catch((err) => {
            console.warn('[MultiCast Profile] Could not seed profile:', err);
          });
        }
      },
      (err) => {
        console.warn('[MultiCast Profile] Listener error:', err);
      },
    );

    const roomsQuery = query(
      collection(firestoreDb, 'users', user.uid, 'recentRooms'),
      orderBy('updatedAt', 'desc'),
      limit(8),
    );

    const unsubRooms = onSnapshot(
      roomsQuery,
      (snapshot) => {
        const rows: RecentRoomEntry[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as {
            ownerUid?: string;
            code?: string;
            role?: 'broadcaster' | 'receiver';
            hostName?: string;
            deviceName?: string;
            updatedAt?: { toMillis?: () => number } | number;
          };
          if (!data.code || !data.role) return;
          const updatedMillis =
            typeof data.updatedAt === 'number'
              ? data.updatedAt
              : typeof data.updatedAt?.toMillis === 'function'
                ? data.updatedAt.toMillis()
                : Date.now();
          rows.push({
            id: docSnap.id,
            ownerUid: data.ownerUid || user.uid,
            code: data.code,
            role: data.role,
            hostName: data.hostName || 'Source Display',
            deviceName: data.deviceName || 'Device',
            updatedAt: updatedMillis,
          });
        });
        setRecentRooms(rows);
      },
      (err) => {
        console.warn('[MultiCast RecentRooms] Listener error:', err);
      },
    );

    return () => {
      unsubProfile();
      unsubRooms();
    };
  }, [isVerifiedUser, user]);

  const getIdToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      const current = firebaseAuth.currentUser;
      if (!current) return null;
      const token = await current.getIdToken(forceRefresh);
      socketClient.setFirebaseToken(token);
      return token;
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(firebaseAuth, provider);
      await verifyWithBackend(cred.user);
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  }, [verifyWithBackend]);

  const registerWithEmail = useCallback(
    async (displayName: string, email: string, password: string) => {
      try {
        const cleanName = displayName.trim().slice(0, 80);
        const cred = await createUserWithEmailAndPassword(
          firebaseAuth,
          email.trim(),
          password,
        );
        if (cleanName) {
          await updateProfile(cred.user, { displayName: cleanName });
        }
        await sendEmailVerification(cred.user);
        await verifyWithBackend(cred.user);
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [verifyWithBackend],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        const cred = await signInWithEmailAndPassword(
          firebaseAuth,
          email.trim(),
          password,
        );
        await verifyWithBackend(cred.user);
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [verifyWithBackend],
  );

  const resendVerificationEmail = useCallback(async () => {
    const current = firebaseAuth.currentUser;
    if (!current) {
      throw new Error('Sign in first to resend the verification email.');
    }
    try {
      await sendEmailVerification(current);
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  }, []);

  const refreshAuthUser = useCallback(async (): Promise<boolean> => {
    const current = firebaseAuth.currentUser;
    if (!current) return false;
    await reload(current);
    await current.getIdToken(true);
    setUser(firebaseAuth.currentUser);
    await verifyWithBackend(firebaseAuth.currentUser);
    return checkIsVerifiedFirebaseUser(firebaseAuth.currentUser);
  }, [verifyWithBackend]);

  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  }, []);

  const confirmPasswordResetCode = useCallback(
    async (oobCode: string, newPassword: string) => {
      try {
        await confirmPasswordReset(firebaseAuth, oobCode, newPassword);
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [],
  );

  const requestPhoneOtp = useCallback(
    async (phoneE164: string, recaptchaContainerId: string) => {
      const normalized = phoneE164.trim();
      if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
        throw new Error(
          'Enter a valid mobile number in E.164 format (for example +14155550100).',
        );
      }

      // Server-side OTP abuse protection / rate limit
      const preflightRes = await fetch('/api/auth/otp-preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: normalized }),
      });
      if (!preflightRes.ok) {
        const errData = (await preflightRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errData.error || 'Too many OTP requests. Please wait before trying again.',
        );
      }

      try {
        if (recaptchaVerifierRef.current) {
          try {
            recaptchaVerifierRef.current.clear();
          } catch {
            // Ignore previous widget teardown error
          }
          recaptchaVerifierRef.current = null;
        }

        const verifier = new RecaptchaVerifier(firebaseAuth, recaptchaContainerId, {
          size: 'invisible',
        });
        recaptchaVerifierRef.current = verifier;

        const confirmation = await signInWithPhoneNumber(
          firebaseAuth,
          normalized,
          verifier,
        );
        phoneConfirmationRef.current = confirmation;
        setPendingPhoneNumber(normalized);
      } catch (err) {
        if (recaptchaVerifierRef.current) {
          try {
            recaptchaVerifierRef.current.clear();
          } catch {
            // Ignore
          }
          recaptchaVerifierRef.current = null;
        }
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [],
  );

  const confirmPhoneOtp = useCallback(
    async (otpCode: string) => {
      const confirmation = phoneConfirmationRef.current;
      if (!confirmation) {
        throw new Error('Request an SMS verification code first.');
      }
      const cleanCode = otpCode.trim();
      if (!/^\d{6}$/.test(cleanCode)) {
        throw new Error('Enter the 6-digit numeric verification code sent via SMS.');
      }
      try {
        const cred = await confirmation.confirm(cleanCode);
        phoneConfirmationRef.current = null;
        setPendingPhoneNumber(null);
        await verifyWithBackend(cred.user);
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [verifyWithBackend],
  );

  const clearPendingPhoneOtp = useCallback(() => {
    phoneConfirmationRef.current = null;
    setPendingPhoneNumber(null);
  }, []);

  const logout = useCallback(async () => {
    phoneConfirmationRef.current = null;
    setPendingPhoneNumber(null);
    socketClient.setFirebaseToken(null);
    await signOut(firebaseAuth);
    setProfile(null);
    setRecentRooms([]);
    setIsAdmin(false);
    setServerVerified(false);
  }, []);

  const updateUserProfile = useCallback(
    async (updates: {
      displayName?: string;
      preferredRole?: 'broadcaster' | 'receiver';
      defaultDeviceName?: string;
    }) => {
      const current = firebaseAuth.currentUser;
      if (!current || !checkIsVerifiedFirebaseUser(current)) {
        throw new Error('Verified MultiCast account required to save profile settings.');
      }
      const path = `users/${current.uid}`;
      const cleanDisplayName = (
        updates.displayName ??
        profile?.displayName ??
        current.displayName ??
        'MultiCast User'
      )
        .trim()
        .slice(0, 80);

      if (!cleanDisplayName) {
        throw new Error('Display name cannot be empty.');
      }

      if (updates.displayName && updates.displayName !== current.displayName) {
        await updateProfile(current, { displayName: cleanDisplayName });
      }

      const payload: Record<string, unknown> = {
        uid: current.uid,
        displayName: cleanDisplayName,
        createdAt: profile ? undefined : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (current.email) payload.email = current.email;
      if (current.phoneNumber) payload.phoneNumber = current.phoneNumber;
      if (current.photoURL) payload.photoURL = current.photoURL;
      if (updates.preferredRole) {
        payload.preferredRole = updates.preferredRole;
      } else if (profile?.preferredRole) {
        payload.preferredRole = profile.preferredRole;
      }
      const nextDeviceName = (
        updates.defaultDeviceName ?? profile?.defaultDeviceName
      )
        ?.trim()
        .slice(0, 64);
      if (nextDeviceName) {
        payload.defaultDeviceName = nextDeviceName;
      }

      // Remove undefined keys for Firestore
      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }

      try {
        await setDoc(doc(firestoreDb, path), payload, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [profile],
  );

  const recordRecentRoom = useCallback(
    async (entry: {
      code: string;
      role: 'broadcaster' | 'receiver';
      hostName: string;
      deviceName: string;
    }) => {
      const current = firebaseAuth.currentUser;
      if (!current || !checkIsVerifiedFirebaseUser(current)) return;

      const cleanCode = entry.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(cleanCode)) return;

      const docId = `${cleanCode}_${entry.role}`;
      const path = `users/${current.uid}/recentRooms/${docId}`;
      try {
        await setDoc(
          doc(firestoreDb, path),
          {
            ownerUid: current.uid,
            code: cleanCode,
            role: entry.role,
            hostName: entry.hostName.trim().slice(0, 64) || 'Source Display',
            deviceName: entry.deviceName.trim().slice(0, 64) || 'Device',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (err) {
        console.warn('[MultiCast RecentRooms] Failed to save history entry:', err);
      }
    },
    [],
  );

  const deleteRecentRoom = useCallback(async (roomId: string) => {
    const current = firebaseAuth.currentUser;
    if (!current || !checkIsVerifiedFirebaseUser(current)) return;
    const path = `users/${current.uid}/recentRooms/${roomId}`;
    try {
      await deleteDoc(doc(firestoreDb, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }, []);

  const providerId = user?.providerData[0]?.providerId || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        recentRooms,
        authLoading,
        isVerifiedUser,
        isAdmin,
        providerId,
        serverVerified,
        serverLimits,
        pendingPhoneNumber,
        getIdToken,
        signInWithGoogle,
        registerWithEmail,
        signInWithEmail,
        resendVerificationEmail,
        refreshAuthUser,
        sendPasswordReset,
        confirmPasswordResetCode,
        requestPhoneOtp,
        confirmPhoneOtp,
        clearPendingPhoneOtp,
        logout,
        updateUserProfile,
        recordRecentRoom,
        deleteRecentRoom,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}
