# MultiCast Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Strict Ownership & PII Isolation (`/users/{userId}`)**:
   - Every `/users/{userId}` document may contain email and phone PII. Only the owning authenticated user (`request.auth.uid == userId`) can `get` their document, and `list` is unconditionally denied (`if false`) so user accounts cannot be enumerated.
   - Users cannot create or update profiles without verified identity (`email_verified == true` or verified `phone` provider with `phone_number`).
   - `uid` and `createdAt` are immutable after creation; `createdAt` (on create) and `updatedAt` (on create/update) must equal `request.time`.
2. **Relational Subcollection Gate (`/users/{userId}/recentRooms/{roomId}`)**:
   - Recent room records cannot exist without an existing parent `/users/{userId}` document (`exists(/databases/$(database)/documents/users/$(userId))`).
   - `ownerUid` must strictly equal `request.auth.uid` and `userId`, and remain immutable on update.
   - `code` must strictly match `^[A-Z0-9]{6}$` (6-char uppercase alphanumeric) and never stores PINs or session tokens.
   - `list` queries explicitly validate `resource.data.ownerUid == request.auth.uid && userId == request.auth.uid` without calling `get()` or `exists()`.
3. **Path Variable & Payload Exhaustion Guards**:
   - Document IDs (`userId`, `roomId`) are validated on `get`, `create`, `update`, `delete` via `isValidId()` (`size <= 128`, `^[a-zA-Z0-9_-]+$`).
   - Every string field enforces strict `.size()` bounds matching `firebase-blueprint.json`.

## 2. The "Dirty Dozen" Attack Payloads (All Expected: `PERMISSION_DENIED`)
1. Unauthenticated read or write to `/users/user_a`.
2. Cross-user PII read: authenticated `user_b` attempting `get` on `/users/user_a`.
3. Collection scraping: authenticated user attempting `list` on `/users`.
4. Unverified email spoofing: password-provider user with `email_verified: false` creating `/users/user_a`.
5. Shadow field injection on create: sending `isAdmin: true` or `role: "admin"` inside `/users/user_a`.
6. UID spoofing on create: `user_b` writing `{ uid: "user_a", ... }` to `/users/user_b`.
7. Fake timestamp injection: creating `/users/user_a` with client-forged `createdAt` != `request.time`.
8. Immutable field tampering on update: changing `uid` or `createdAt` on `/users/user_a`.
9. Oversized payload DoS: writing a 50KB `displayName` or `deviceName`.
10. Orphaned subcollection write: writing `/users/user_a/recentRooms/K7P4M9_broadcaster` before `/users/user_a` exists.
11. Cross-user recent room hijacking: `user_b` writing `/users/user_a/recentRooms/K7P4M9_receiver` with `ownerUid: "user_b"`.
12. Ghost secret injection in recent rooms: adding `{ pin: "1234" }` to `/users/user_a/recentRooms/K7P4M9_receiver`.
