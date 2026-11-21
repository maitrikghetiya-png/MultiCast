import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.tsx';

type AuthMode = 'signin' | 'register' | 'forgot' | 'reset';
type AuthMethod = 'email' | 'phone';

interface AuthPageProps {
  resetOobCode?: string | null;
  redirectReason?: string | null;
  onAuthenticated: () => void;
  onCancel?: () => void;
}

export function AuthPage({
  resetOobCode,
  redirectReason,
  onAuthenticated,
  onCancel,
}: AuthPageProps) {
  const {
    user,
    isVerifiedUser,
    pendingPhoneNumber,
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
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>(() => (resetOobCode ? 'reset' : 'signin'));
  const [method, setMethod] = useState<AuthMethod>('email');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (resetOobCode) {
      setMode('reset');
    }
  }, [resetOobCode]);

  useEffect(() => {
    if (user && isVerifiedUser) {
      onAuthenticated();
    }
  }, [isVerifiedUser, onAuthenticated, user]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        if (!displayName.trim()) {
          throw new Error('Enter your full name or host label.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        await registerWithEmail(displayName, email, password);
        setNotice(
          'Account created! A verification email has been sent to your inbox. Verify it to unlock broadcast rooms.',
        );
      } else if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else if (mode === 'forgot') {
        await sendPasswordReset(email);
        setNotice(
          'Password reset email sent. Check your inbox and follow the reset link.',
        );
      } else if (mode === 'reset') {
        if (!resetOobCode) {
          throw new Error('Missing password reset verification code in URL.');
        }
        if (password.length < 6) {
          throw new Error('New password must be at least 6 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        await confirmPasswordResetCode(resetOobCode, password);
        setNotice('Password updated! You can now sign in with your new password.');
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendPhoneOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await requestPhoneOtp(phoneInput, 'multicast-recaptcha-container');
      setNotice(
        `Verification code sent to ${phoneInput.trim()}. Enter the 6-digit SMS code below.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send SMS code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await confirmPhoneOtp(otpInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      await resendVerificationEmail();
      setNotice('Verification email resent. Check your inbox (and spam folder).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckVerification = async () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const verified = await refreshAuthUser();
      if (!verified) {
        setNotice('Email is not marked verified yet. Click the link in your inbox first.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh account status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Signed in with email/password, waiting on email verification
  if (user && !isVerifiedUser) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-xs">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold text-zinc-900">
            Verify Your Email Address
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            Signed in as <span className="font-medium text-zinc-900">{user.email}</span>.
            Confirm your email address before creating MultiCast broadcast rooms or saving account preferences.
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCheckVerification}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D91B24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B8141C] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isSubmitting ? 'animate-spin' : ''}`} />
              I Verified My Email
            </button>

            <button
              type="button"
              onClick={handleResendVerification}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
            >
              Resend Verification Email
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-[#D91B24] uppercase">
              <ShieldCheck className="h-4 w-4" />
              MultiCast Account
            </div>
            <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-zinc-900">
              {mode === 'signin'
                ? 'Sign in to MultiCast'
                : mode === 'register'
                  ? 'Create a MultiCast account'
                  : mode === 'forgot'
                    ? 'Reset your password'
                    : 'Set a new password'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {mode === 'signin'
                ? 'Required for hosting broadcast rooms and managing your account profile.'
                : mode === 'register'
                  ? 'Register with Google, verified email, or mobile SMS verification.'
                  : mode === 'forgot'
                    ? 'We will send a secure password reset link to your email.'
                    : 'Choose a new password for your MultiCast account.'}
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              Back
            </button>
          )}
        </div>

        {redirectReason && !error && (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-700">
            {redirectReason}
          </div>
        )}

        {(mode === 'signin' || mode === 'register') && (
          <>
            <div className="mt-6 grid grid-cols-2 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setNotice(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'signin'
                    ? 'bg-white text-zinc-900 shadow-2xs'
                    : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setNotice(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === 'register'
                    ? 'bg-white text-zinc-900 shadow-2xs'
                    : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                Register
              </button>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting}
              className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-60"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
              <div className="h-px flex-1 bg-zinc-200" />
              <span>or continue with</span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMethod('email');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  method === 'email'
                    ? 'border-[#D91B24] bg-red-50/50 text-[#D91B24]'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                Email & Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setMethod('phone');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  method === 'phone'
                    ? 'border-[#D91B24] bg-red-50/50 text-[#D91B24]'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                <Phone className="h-3.5 w-3.5" />
                Mobile OTP
              </button>
            </div>
          </>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {(mode === 'forgot' || mode === 'reset' || method === 'email') && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="mt-1.5 w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-base sm:text-sm text-zinc-900 outline-hidden transition focus:border-[#D91B24]"
                />
              </div>
            )}

            {(mode === 'signin' || mode === 'register' || mode === 'forgot') && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5 w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-base sm:text-sm text-zinc-900 outline-hidden transition focus:border-[#D91B24]"
                />
              </div>
            )}

            {(mode === 'signin' || mode === 'register' || mode === 'reset') && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-zinc-700">
                    {mode === 'reset' ? 'New Password' : 'Password'}
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setError(null);
                        setNotice(null);
                      }}
                      className="text-xs font-medium text-[#D91B24] hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="mt-1.5 w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-base sm:text-sm text-zinc-900 outline-hidden transition focus:border-[#D91B24]"
                />
              </div>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="mt-1.5 w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-base sm:text-sm text-zinc-900 outline-hidden transition focus:border-[#D91B24]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#D91B24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B8141C] disabled:opacity-60 touch-manipulation"
            >
              {mode === 'register' ? (
                <>
                  <UserPlus className="h-4 w-4" />
                  {isSubmitting ? 'Creating account...' : 'Create Account'}
                </>
              ) : mode === 'forgot' ? (
                <>
                  <KeyRound className="h-4 w-4" />
                  {isSubmitting ? 'Sending reset link...' : 'Send Reset Link'}
                </>
              ) : mode === 'reset' ? (
                <>
                  <KeyRound className="h-4 w-4" />
                  {isSubmitting ? 'Updating password...' : 'Save New Password'}
                </>
              ) : (
                <>
                  {isSubmitting ? 'Signing in...' : 'Sign In'}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            {(mode === 'forgot' || mode === 'reset') && (
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setNotice(null);
                }}
                className="w-full text-center text-xs font-medium text-zinc-500 hover:text-zinc-900"
              >
                Back to Sign In
              </button>
            )}
          </form>
        )}

        {(mode === 'signin' || mode === 'register') && method === 'phone' && (
          <div className="space-y-4">
            {!pendingPhoneNumber ? (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700">
                    Mobile Number (E.164 international format)
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="+14155550100"
                    className="mt-1.5 w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 font-mono text-base sm:text-sm text-zinc-900 outline-hidden transition focus:border-[#D91B24]"
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Include country code (e.g. +1 for US/Canada, +91 for India). Protected by server OTP rate limiting and reCAPTCHA.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#D91B24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B8141C] disabled:opacity-60"
                >
                  <Phone className="h-4 w-4" />
                  {isSubmitting ? 'Sending SMS code...' : 'Send Verification Code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700">
                    6-Digit SMS Verification Code for{' '}
                    <span className="font-mono text-zinc-900">{pendingPhoneNumber}</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 font-mono text-base tracking-widest text-zinc-900 outline-hidden transition focus:border-[#D91B24]"
                  />
                </div>

                <div className="flex gap-2.5">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#D91B24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B8141C] disabled:opacity-60"
                  >
                    {isSubmitting ? 'Verifying...' : 'Verify & Continue'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearPendingPhoneOtp();
                      setOtpInput('');
                      setError(null);
                      setNotice(null);
                    }}
                    className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                  >
                    Change Number
                  </button>
                </div>
              </form>
            )}

            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
              SMS delivery uses Firebase Phone Authentication (requires Firebase Blaze billing for live carrier SMS or Firebase test numbers during development).
            </p>
            <div id="multicast-recaptcha-container" />
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-zinc-500">
        Receivers joining with a Room Code &amp; PIN can connect directly without signing in.
        {' · '}Made by Maitrik Ghetiya
      </p>
    </div>
  );
}
