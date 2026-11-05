# raffle-wheel

QR-code raffle wheel and event check-in platform featuring:
- **Attendee Check-In**: First name, last name, and Hofstra email username input with non-editable visible `@hofstra.edu` suffix.
- **Dedicated Confirmation Screen**: Clean accessible screen state confirming check-in and raffle entry without exposing private data.
- **Private Attendance Records**: Authoritative Supabase Postgres storage with per-event email uniqueness, atomic concurrency guarantees, and host-only email access.
- **Excel Attendance Export**: Genuine `.xlsx` workbook generation (`Event`, `First Name`, `Last Name`, `Hofstra Email`, `Check-in Time (UTC)`) with spreadsheet formula injection protection.
- **Fair Server-Authoritative Draws**: Cryptographically secure, unbiased random index generation with immutable snapshots and serialized transactional locking.
- **Classic iPod-Inspired UI**: Restrained off-white, silver, and light-gray surfaces with crisp typography and tactile controls.

---

## Architecture

- **Frontend**: React 19 + TypeScript + Vite with HashRouter routing (`#/e/:slug`, `#/host`, `#/host/projector/:eventId`) compatible with GitHub Pages project site paths.
- **Backend**: Supabase Postgres + Row Level Security (RLS) + SQL security-definer RPC functions + Supabase Edge Functions.
- **Authoritative Persistence**: Shared Postgres tables (`events`, `entries`, `draws`, `rate_limit_windows`).
- **Public Attendee API**: Edge Functions (`public-event` and `public-submit`) with CORS handling, OPTIONS preflight support, server-side validation, idempotency, rate limiting, and zero exposure of administrative credentials or attendee records.
- **Host Operations**: Authenticated host identity (`auth.uid()`), owner-scoped RLS policies, and server-side RPC functions.

---

## Features & Requirements Summary

### 1. Attendee Check-In
- Directly accessed via QR code link: `/#/e/:slug`.
- Fields:
  - First name (Unicode support, spaces, apostrophes, hyphens, preserved casing).
  - Last name (Unicode support, spaces, apostrophes, hyphens, preserved casing).
  - Hofstra email username with visible, non-editable `@hofstra.edu` suffix.
- Normalization:
  - Typing `aventura2` stores `aventura2@hofstra.edu`.
  - Pasting a full `aventura2@hofstra.edu` address strips the domain and populates the username.
  - Rejects other domains and malformed inputs with inline errors.
- Primary button: `Check In & Join Raffle`.
- Zero login, password, app download, or email verification required for attendees.

### 2. Dedicated Confirmation Screen
- Replaces the entire form upon server confirmation:
  - **Heading**: `Thank you for attending the NASA event!`
  - **Greeting**: `You’re checked in, [First Name], and entered into the raffle.`
  - **Instruction**: `Watch the main screen for the drawing.`
  - **Dismissal**: `You can close this page.`
  - **Context**: Event title displayed as secondary context.
- Moves accessible focus directly to the confirmation heading on mount.
- Safe text rendering without exposing emails, internal IDs, or host controls.
- Safe retries and input preservation on failure. Duplicate email rejections are treated as errors rather than false personal check-in confirmations.

### 3. Private Attendance Records & Security
- Per-event atomic uniqueness on normalized email: only one entry per email per event.
- Different people with matching names and different emails are permitted and flagged to the host.
- Non-destructive exclusion: excluding an attendee from the raffle marks them ineligible while preserving attendance records, timestamps, and draw history.
- Realtime publication configured on `entries` and `draws` with periodic fallback polling.
- Default function execution revoked from `public` and `anon`; granted only to `authenticated` or `service_role`.
- Advisory locking (`pg_advisory_xact_lock`) serializes draws and mutations.

### 4. Excel Attendance Export
- Host-only **Download Excel** action producing a genuine `.xlsx` workbook (via `write-excel-file`).
- Columns: `Event | First Name | Last Name | Hofstra Email | Check-in Time (UTC)`.
- Exports all records for the selected event (including ineligible or winning attendees).
- Formatted bold headers and explicit column widths.
- Sanitizes formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) to ensure spreadsheet safety.

### 5. Host Dashboard & Projector Wheel
- Protected host sign-in with event creation and management.
- Live participant count, searchable attendance table, duplicate name badges, and exclusion controls.
- Deterministic raffle drawings animated to the exact server-persisted winner.
- Projector mode with a live QR code panel, large readable winner banner, and zero email exposure.

### 6. iPod-Inspired Aesthetics
- Restrained off-white, silver, and light-gray palette (`#f5f5f7`, `#ffffff`, `#d2d2d7`).
- Crisp dark text (`#1d1d1f`) and subtle blue focus rings (`#0071e3`).
- Modest corner radii (6px - 10px), tactile buttons, and no neon gradients or glassmorphism.

---

## Deployment & Setup Guide

### 1. Supabase Backend Setup

1. **Install Supabase CLI & Link Project**:
   ```bash
   supabase login
   supabase link --project-ref <your-project-id>
   ```

2. **Apply Migrations**:
   ```bash
   supabase db push
   ```

3. **Deploy Edge Functions**:
   ```bash
   supabase functions deploy public-event --no-verify-jwt
   supabase functions deploy public-submit --no-verify-jwt
   ```

4. **Configure Secrets**:
   Ensure edge function environment variables are set:
   - `SUPABASE_URL`: Your Supabase Project URL (`https://<project-ref>.supabase.co`)
   - `SUPABASE_SERVICE_ROLE_KEY`: Your service role secret key

5. **Configure Authentication**:
   - In Supabase Dashboard -> Authentication -> URL Configuration:
     - Set Site URL and Redirect URLs to your GitHub Pages URL (e.g., `https://adrielvent.github.io/raffle-wheel/`).

### 2. GitHub Pages Deployment

1. **Repository Settings**:
   - Go to GitHub Repository -> **Settings** -> **Pages**.
   - Under **Build and deployment**, select **GitHub Actions**.

2. **Repository Variables**:
   In GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions** -> **Variables**:
   - `ENABLE_PAGES_DEPLOY`: Set to `true` to enable deployment.
   - `VITE_SUPABASE_URL`: Your Supabase URL (`https://<project-ref>.supabase.co`).
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anonymous public key.
   - `VITE_BASE_PATH`: Set to `/raffle-wheel/`.

3. **Trigger Deployment**:
   Push to `main` or trigger the **Build and Deploy Pages** workflow manually from the **Actions** tab.

---

## Running Tests Locally

```bash
# Typecheck
npm run typecheck

# Linter
npm run lint

# Automated test suite with coverage
npm run test

# Production build
npm run build
```
