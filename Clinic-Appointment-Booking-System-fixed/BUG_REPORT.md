# ClinicQ Bug Report — Updated Audit

Audit date: 2026-10-07

## Bugs addressed

### BUG #1 — Doctor value mismatch
**Severity:** Critical — Fixed

The patient portal now loads doctors from `/doctors` and submits the canonical doctor name instead of the display label.

### BUG #2 — Missing authentication / booking ownership
**Severity:** High — Fixed

Administrative endpoints require Basic authentication and patient booking details/cancellation/PDF access require a random per-booking access token.

### BUG #3 — Stored HTML injection in admin UI
**Severity:** Medium — Fixed

Booking fields are escaped before HTML interpolation and toast messages are rendered as text.

### BUG #4 — Weak API input validation
**Severity:** Medium — Fixed

The API validates field types, non-empty strings, phone format, integer age, doctor, and time slot before storing a booking.

### BUG #5 — Invalid/past appointments accepted
**Severity:** Medium — Fixed

The server validates real calendar dates, rejects past dates, and rejects already-started slots. The frontend also sets the date minimum and refreshes availability.

### BUG #6 — Cancelled slots remained reserved / invalid state transitions
**Severity:** Medium — Fixed

Only pending and confirmed bookings reserve slots. Booking state transitions are validated.

### BUG #7 — Static/stale frontend time slots
**Severity:** Medium — Fixed

Doctor/date changes now request live availability from the backend and clear stale slot selections.

### BUG #8 — Cancelled bookings missing from admin history
**Severity:** Low — Fixed

Cancelled status has its own count and admin tab.

### BUG #9 — Unsafe numeric-prefix booking IDs
**Severity:** Low — Fixed

Booking IDs must contain only digits and be safe integers.

### BUG #10 — Bookings lost on server restart
**Severity:** High — Fixed

The previous in-memory array has been replaced with persistent JSON storage in `data/bookings.json`. Writes use a temporary file followed by an atomic rename. The location can be overridden with `BOOKINGS_FILE`.

The regression suite now explicitly creates a booking, restarts/reloads the server, and verifies the booking still exists.

### BUG #11 — GitHub Pages API/deployment mismatch
**Severity:** High — Configuration fixed; external deployment still required

**Problem:** GitHub Pages serves static files and cannot execute the Node.js API. The old frontend used relative API URLs, so `/doctors` on GitHub Pages returned the site's HTML instead of JSON, producing:

`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

**Fix implemented:**
- Added `config.js` with a configurable `CLINICQ_API_BASE_URL`.
- Centralized API requests in `apiJson()`.
- Added safe handling for network failures and non-JSON responses.
- Added configurable CORS support via `CORS_ORIGIN`.
- Updated README with the GitHub Pages + backend deployment procedure.

**Important:** A public Node.js backend still has to be deployed. GitHub Pages alone cannot provide the booking API.

## Validation performed

- `npm test`: **10/10 passed**
- `node -c server.js`: passed
- `node -c script.js`: passed
- `node -c config.js`: passed
- Live `/doctors` endpoint: HTTP 200 with JSON
- CORS preflight from `https://yashbiradar-12.github.io`: HTTP 204 with the expected allowed headers/methods
- Persistence test: passed across a simulated server restart
- Existing API regression coverage retained for authentication, validation, availability, concurrency, cancellation, PDF, and malformed JSON.

## Remaining deployment step

For GitHub Pages to work end-to-end:

1. Deploy this Node.js backend to a Node-compatible HTTPS host.
2. Set `ADMIN_PASSWORD` on the backend.
3. Set `HOST=0.0.0.0` on the backend host.
4. Set `CORS_ORIGIN=https://yashbiradar-12.github.io`.
5. Put the backend's HTTPS URL into `config.js`:

```js
window.CLINICQ_API_BASE_URL = "https://YOUR-BACKEND-URL";
```

6. Push the updated static frontend to GitHub Pages.
7. Test doctors → availability → booking → confirmation against the deployed backend.

## Production note

The JSON persistence implementation is appropriate for a small single-instance portfolio/demo deployment. For a real multi-instance clinic service, use a managed transactional database and keep the same API contract.
