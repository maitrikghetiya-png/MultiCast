/**
 * Firestore Security Rules Adversarial Test Specification ("Dirty Dozen")
 *
 * Documents the 12 adversarial test cases verified against firestore.rules.
 * Designed for execution with @firebase/rules-unit-testing when a local
 * Firestore Emulator is available.
 */

export const DIRTY_DOZEN_CASES = [
  {
    id: 1,
    name: 'Unauthenticated read/write to /users/{userId}',
    path: 'users/user_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-user PII read on /users/{userId}',
    actor: 'user_b',
    path: 'users/user_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Blanket list query on /users',
    actor: 'user_a',
    path: 'users',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unverified password user profile creation (email_verified == false)',
    actor: 'unverified_user_a',
    path: 'users/unverified_user_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow privilege escalation field (isAdmin: true) on UserProfile create',
    actor: 'user_a',
    path: 'users/user_a',
    payload: { uid: 'user_a', displayName: 'Alice', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'UID spoofing inside UserProfile document body',
    actor: 'user_b',
    path: 'users/user_b',
    payload: { uid: 'user_a', displayName: 'Mallory' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client-forged createdAt timestamp not equal to request.time',
    actor: 'user_a',
    path: 'users/user_a',
    payload: { uid: 'user_a', displayName: 'Alice', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable createdAt/uid tampering during UserProfile update',
    actor: 'user_a',
    path: 'users/user_a',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Resource poisoning with oversized displayName (>80 chars)',
    actor: 'user_a',
    path: 'users/user_a',
    payload: { uid: 'user_a', displayName: 'A'.repeat(2048) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned RecentRoom creation without parent /users/{userId}',
    actor: 'user_orphan',
    path: 'users/user_orphan/recentRooms/K7P4M9_broadcaster',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Invalid room code pattern in RecentRoom (lowercase / injection)',
    actor: 'user_a',
    path: 'users/user_a/recentRooms/bad_code',
    payload: { ownerUid: 'user_a', code: 'bad!!', role: 'receiver' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Ghost field (pin) injection on RecentRoom create/update',
    actor: 'user_a',
    path: 'users/user_a/recentRooms/K7P4M9_receiver',
    payload: { ownerUid: 'user_a', code: 'K7P4M9', role: 'receiver', pin: '4821' },
    expected: 'PERMISSION_DENIED',
  },
] as const;
