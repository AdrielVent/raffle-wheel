# raffle-wheel

QR-code raffle wheel for college events with attendee check-in (first name, last name, Hofstra email) and authenticated host controls.

## Architecture

- **Frontend**: React + TypeScript + Vite, hash-route friendly for GitHub Pages project-site hosting.
- **Backend**: Supabase Postgres + RLS + SQL functions + Supabase Edge Functions.
- **Authoritative persistence**: Postgres (`events`, `entries`, `draws`).
- **Public attendee API**: `public-event` and `public-submit` edge functions with server-side validation, state checks, idempotency, and rate limiting.
- **Host operations**: Supabase Auth + owner-scoped RLS + authenticated SQL RPC functions.

## Prerequisites

- Node.js 22+
- npm 10+
- Supabase project (with CLI access for migrations/functions)

## Local frontend setup

1. Copy `.env.example` to `.env`.
2. Set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Install deps:
   ```bash
   npm ci
   ```
4. Run dev server:
   ```bash
   npm run dev
   ```

If env vars are missing, the UI shows an explicit **backend setup required** state (no fake success behavior).

## Supabase setup (database + auth + server functions)

1. Link Supabase project and apply migration:
   ```bash
   supabase db push
   ```
2. Deploy edge functions:
   ```bash
   supabase functions deploy public-event
   supabase functions deploy public-submit
   ```
3. In Supabase dashboard, configure Auth provider(s) for hosts (magic-link email is supported by current UI).
4. Set edge-function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Ensure Realtime is enabled for `entries` and `draws` if you want live updates in host mode.

## GitHub Pages workflow setup

A Pages workflow is provided at `.github/workflows/pages.yml`.

- It always builds on `main` pushes/workflow dispatch.
- Deployment is intentionally gated by repository variable:
  - `ENABLE_PAGES_DEPLOY=true`

This avoids accidental public deployment before backend setup and repository secrets/variables are ready.

## Security model

- No service-role key in frontend.
- Public attendee access only through edge functions with minimal response data.
- Anonymous direct table reads/writes are blocked by RLS (no anonymous policies).
- Host access requires authenticated owner identity (`auth.uid()`) for event-scoped data/actions.
- Draws use server-side, locked, idempotent SQL function with immutable eligible-entry snapshots and atomic winner persistence.
- Random draw index uses cryptographic randomness (`gen_random_bytes`) with rejection sampling to avoid modulo bias.

## Data handling and privacy

- Attendee page requires first name, last name, and Hofstra email username (rendered as `username + @hofstra.edu`).
- The server normalizes username input and constructs the final `@hofstra.edu` email server-side.
- Browser storage stores only event-specific retry IDs and host UI preferences.
- No authoritative participant list in browser storage.
- Privacy notice is shown on attendee screen.
- A self-reported Hofstra email does **not** verify mailbox ownership, enrollment, physical attendance, or one unique human.
- Rate-limiting uses transient hashed network fingerprint (`x-forwarded-for` + user agent hash) per minute window.

## Host operator guide

Host dashboard supports:

- Create named events
- Copy entry link + download QR
- Live participant count/list with search (including host-only Hofstra email visibility)
- Duplicate-name flagging (without auto-rejection)
- Remove entries
- Open/close registration
- Run multiple draws
- Winner history
- Toggle winner removal from future draws
- Clear entries (confirmation)
- End events
- Delete event data
- Projector mode with wheel animation and winner banner (winner names only)

## Tests and verification

Automated tests currently cover:

- Name validation (Unicode + allowed punctuation)
- Hofstra username/email normalization (username-only and pasted full address)
- Duplicate-name flagging logic
- Closed/ended/invalid state helpers
- Wheel landing calculations

Run:

```bash
npm run typecheck
npm run build
npm run test
```

### Integration/concurrency/security checks (requires deployed Supabase)

Manual/integration checks to run against a real Supabase project:

1. Public submit idempotency (`submission_id` retry does not duplicate rows).
2. Same-name/different-email entrants are accepted and flagged only for matching names.
3. Username/email normalization handles pasted `@hofstra.edu` values and rejects other domains.
4. Per-event email uniqueness is enforced atomically under concurrent requests.
5. Closed/ended events reject public submissions server-side.
6. Anonymous client cannot read/write protected tables directly.
7. Cross-event isolation: host can only see/manage owned events.
8. Concurrent draw requests with same `request_id` return same persisted winner.
9. Concurrent different draw requests are serialized per event lock.
10. Snapshot integrity: winner and animation remain tied to saved snapshot despite later entry updates.
11. Public responses and projector mode never disclose attendee emails.
12. Event deletion removes email-containing check-in records.

## Cost/quota items to verify in your own environment

- Supabase database row limits/storage
- Edge function execution/runtime quotas
- Realtime connection/message quotas
- Auth email provider throughput and pricing
- GitHub Pages bandwidth/build limits

## Known limitations

- Hofstra email is self-reported only; no verification/SSO is performed.
- Projector wheel currently emphasizes deterministic landing and readability over advanced decorative visuals.
- Optional winner sound uses a minimal built-in audio cue.
- Full two-device acceptance checks require deployed Supabase and physical QR scans.

## Acceptance checklist

- [ ] QR scanning opens first/last/Hofstra-email check-in page
- [ ] Entry succeeds only after server confirmation
- [ ] Retry deduplication prevents duplicate inserts
- [ ] Per-event email uniqueness blocks second entry for same normalized email
- [ ] Matching-name entrants with different emails are both accepted and flagged for host
- [ ] Live host updates across devices
- [ ] Closed registration enforced server-side
- [ ] Ended event enforced server-side
- [ ] Host-only data/actions (including emails) protected by auth + owner checks
- [ ] Draw snapshots preserved and wheel lands on persisted winner
- [ ] Winner removal toggle works without deleting history
- [ ] Event deletion and clear-entry confirmation flows work
- [ ] No demo/local fake participant persistence is used
