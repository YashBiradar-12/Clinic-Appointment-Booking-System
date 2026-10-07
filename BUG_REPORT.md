# ClinicQ Bug Report and Final Test Report

Audit date: 2026-10-06

## Bug report

### BUG #1

- **Severity:** Critical — Fixed
- **Area:** Booking / API integration
- **Problem:** The patient portal sent a doctor's display label, such as `Dr. Priya Sharma (General Physician)`, while the API accepts only the canonical doctor name.
- **Expected behavior:** Submitting a valid booking from the portal creates the appointment and opens its confirmation page.
- **Actual behavior:** Every portal booking was rejected with HTTP 400, `Invalid doctor selected.`
- **Steps to reproduce:** Open the patient portal, complete all fields with a valid future date and slot, select any doctor, and submit.
- **Root cause:** Doctor options were hardcoded in the client and used the display string as the request value; the server validates against `/doctors` names.
- **Affected files:** [script.js](./script.js), [server.js](./server.js), [index.html](./index.html)
- **Recommended fix:** Populate the selector from `/doctors`; submit `doctor.name` and show the specialization only as its label. Implemented and verified in the browser.

### BUG #2

- **Severity:** High — Fixed
- **Area:** Authentication / API security
- **Problem:** Patient details and administrative state-changing routes had no authentication or ownership checks.
- **Expected behavior:** Only an administrator can view/manage all bookings; patients can access only their own booking.
- **Actual behavior:** Before the fix, booking records could be listed and confirmed, rejected, cancelled, removed from the queue, or reset without credentials. Individual booking details and PDFs were also accessible by sequential IDs.
- **Steps to reproduce:** Before the fix, request `GET /bookings` without credentials, or call a management route such as `POST /reset`.
- **Root cause:** No authentication middleware or per-booking ownership credential existed.
- **Affected files:** [server.js](./server.js), [admin.html](./admin.html), [script.js](./script.js), [confirmation.html](./confirmation.html)
- **Recommended fix:** Require a configured administrator password for management APIs and random per-booking access tokens for patient details, cancellation, and PDFs. Bind to loopback by default. Implemented; unauthorized requests now return 401/404, or 503 when admin credentials are not configured.

### BUG #3

- **Severity:** Medium — Fixed
- **Area:** Security / Admin UI
- **Problem:** Patient-provided fields were interpolated into the admin panel with `innerHTML`.
- **Expected behavior:** Patient content is displayed only as text.
- **Actual behavior:** Crafted HTML in a patient name or complaint could execute when an administrator opened the booking list.
- **Steps to reproduce:** Before the fix, submit a booking with HTML in the name or complaint, then open the admin panel.
- **Root cause:** Untrusted values were inserted into HTML without context-appropriate escaping.
- **Affected files:** [script.js](./script.js), [server.js](./server.js)
- **Recommended fix:** Escape all booking values rendered in HTML and render toast content as text. Implemented; a browser test confirmed HTML-looking names remain literal text.

### BUG #4

- **Severity:** Medium — Fixed
- **Area:** API validation / Error handling
- **Problem:** Input types and normalized values were not validated before string and number operations.
- **Expected behavior:** Malformed values return a clear HTTP 400 response without storing an invalid booking or crashing a route.
- **Actual behavior:** Numeric names and phone values produced HTTP 500 errors; whitespace-only names/problems were stored as empty strings; fractional ages were accepted.
- **Steps to reproduce:** Before the fix, submit a JSON booking with `name: 123`, numeric `phone`, whitespace-only fields, or a fractional age.
- **Root cause:** The route relied on truthiness and called `.trim()` / `.replace()` without type guards; age validation allowed non-integers.
- **Affected files:** [server.js](./server.js)
- **Recommended fix:** Validate field types, trimmed non-empty strings, integer age and phone format before booking creation; return JSON errors for malformed JSON and server errors. Implemented and covered by API regression tests.

### BUG #5

- **Severity:** Medium — Fixed
- **Area:** Booking / Time-slot validation
- **Problem:** The API accepted malformed, impossible, past dates and already-started time slots.
- **Expected behavior:** Only valid ISO calendar dates and future appointment slots are accepted.
- **Actual behavior:** A past date such as `2020-01-01` and malformed strings were accepted; the backend did not reject a past time on the current date.
- **Steps to reproduce:** Before the fix, submit an otherwise valid booking with a past or invalid date, or a time slot that has already started today.
- **Root cause:** The create route checked only for a non-empty date string and did not compare appointment date/time with the current date/time.
- **Affected files:** [server.js](./server.js), [script.js](./script.js), [index.html](./index.html)
- **Recommended fix:** Validate real `YYYY-MM-DD` dates and reject past dates/times on the server; set the date input minimum and exclude past slots in availability. Implemented. Comparisons use the server's local time zone.

### BUG #6

- **Severity:** Medium — Fixed
- **Area:** Booking lifecycle / Slot availability
- **Problem:** Cancelled appointments continued to reserve their slot, and terminal booking states could be reversed.
- **Expected behavior:** Cancellation releases the slot; rejected/cancelled bookings cannot be confirmed or rejected later.
- **Actual behavior:** Before the fix, a cancelled slot returned HTTP 409 for a new booking, and an already-cancelled booking could be confirmed.
- **Steps to reproduce:** Book and cancel a slot, try to book that same doctor/date/slot again, then call `POST /confirm/:id` for the cancelled booking.
- **Root cause:** Overlap checks excluded only rejected bookings, and state-changing routes had no transition validation.
- **Affected files:** [server.js](./server.js), [script.js](./script.js)
- **Recommended fix:** Reserve slots only for pending/confirmed bookings and enforce valid pending → confirmed/rejected and pending/confirmed → cancelled transitions. Implemented and tested for cancellation, rejection, and duplicate transitions.

### BUG #7

- **Severity:** Medium — Fixed
- **Area:** Frontend / Time-slot availability
- **Problem:** The portal showed the same hardcoded slots for every doctor and date, including slots already taken or already past.
- **Expected behavior:** Changing doctor/date refreshes available slots and clears any prior time selection.
- **Actual behavior:** Before the fix, the UI always showed all three slots; a stale selection could be submitted after changing the doctor/date and only failed later at the API.
- **Steps to reproduce:** Select a doctor/date and slot, change the doctor or date, then inspect the slot list; repeat with an already-booked slot.
- **Root cause:** Slot options were static HTML and did not use booking availability.
- **Affected files:** [server.js](./server.js), [script.js](./script.js), [index.html](./index.html)
- **Recommended fix:** Add a doctor/date availability endpoint and refresh the selector whenever either value changes. Implemented; server-side overlap validation remains authoritative.

### BUG #8

- **Severity:** Low — Fixed
- **Area:** Admin UI / Booking history
- **Problem:** Cancelled appointments were counted in totals but had no admin tab or status count.
- **Expected behavior:** Administrators can see cancelled bookings and reconcile status totals.
- **Actual behavior:** Cancelled records were omitted from all status tabs.
- **Steps to reproduce:** Cancel a booking and inspect the admin tabs and counts.
- **Root cause:** The admin interface only filtered pending, confirmed, and rejected records.
- **Affected files:** [admin.html](./admin.html), [script.js](./script.js), [style.css](./style.css)
- **Recommended fix:** Add a cancelled count and tab. Implemented.

### BUG #9

- **Severity:** Low — Fixed
- **Area:** API / ID validation
- **Problem:** Booking lookup used `parseInt`, so an ID with a valid numeric prefix could resolve to a real booking.
- **Expected behavior:** Malformed IDs return 404 and never alias a valid booking.
- **Actual behavior:** Before the fix, `/booking/1junk` could return booking `1`.
- **Steps to reproduce:** With a booking whose ID is 1, request `/booking/1junk`.
- **Root cause:** `parseInt` accepted a numeric prefix and ignored trailing characters.
- **Affected files:** [server.js](./server.js), [test/booking.test.js](./test/booking.test.js)
- **Recommended fix:** Require the entire ID path parameter to contain only digits and a safe integer. Implemented and tested.

### BUG #10

- **Severity:** High — Remaining
- **Area:** Database / Data durability
- **Problem:** Booking records exist only in a process-local array and are lost on restart.
- **Expected behavior:** Confirmed appointments survive a server restart.
- **Actual behavior:** Reproduced by creating a local test booking, restarting the server, and observing an empty `GET /bookings` response.
- **Steps to reproduce:** Create a booking, restart the server, then fetch the booking list.
- **Root cause:** `server.js` uses in-memory storage; [database.js](./database.js) is an unused placeholder and no database is configured.
- **Affected files:** [server.js](./server.js), [database.js](./database.js)
- **Recommended fix:** Choose and implement a persistent database with transactional uniqueness for doctor/date/time-slot bookings. Not changed because the repository explicitly describes in-memory storage as its MVP design and no database choice/configuration exists.

## Security review summary

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | [server.js](./server.js) | 51, 160-165, 250-311, 397-401 | Patient data and administrative endpoints were unauthenticated; fixed with admin authentication and per-booking access tokens. | 9/10 |
| 2 | 🟡 MEDIUM | [script.js](./script.js) | 209-269 | Stored HTML/script injection in admin booking rendering; fixed by escaping dynamic values and using text APIs for notifications. | 9/10 |

## Final test report

1. **Total bugs found:** 10
2. **Critical bugs:** 1
3. **High-priority bugs:** 2 (1 fixed, 1 remaining)
4. **Medium-priority bugs:** 5
5. **Low-priority bugs:** 2
6. **Bugs fixed:** 9
7. **Bugs still remaining:** 1 — bookings are not persistent across restarts.
8. **Tests executed:** Existing test inventory (none existed); `npm test` API regression suite; JavaScript syntax checks; `git diff --check`; startup with and without admin credentials; live browser booking/admin/cancellation/error-flow checks; API validation, authorization, availability, concurrency, PDF, and state-transition checks.
9. **Tests passed/failed:** 9/9 automated API regression checks passed. Startup, API, booking, admin confirmation, cancellation, XSS rendering, and network-failure smoke checks passed. PDF endpoint returned HTTP 200 with `application/pdf` and an attachment disposition; the browser harness did not expose a saved-file/download event, so the on-disk download is unverified.
10. **Files changed:** [admin.html](./admin.html), [confirmation.html](./confirmation.html), [index.html](./index.html), [package.json](./package.json), [script.js](./script.js), [server.js](./server.js), [style.css](./style.css), [README.md](./README.md), [test/booking.test.js](./test/booking.test.js), and [BUG_REPORT.md](./BUG_REPORT.md).
11. **Warnings/risks:** No persistent database; restart loses records. The server uses its local time zone for booking comparisons. Admin APIs require `ADMIN_PASSWORD` (at least 12 characters); without it, admin access is disabled. The server binds to loopback by default; configure HTTPS before exposing it to a network. Patient registration/login, multi-booking account history, rescheduling, and real SMS delivery are not implemented. Mobile rendering could not be fully verified because the browser harness did not apply the requested viewport size.
12. **Overall project health:** 6/10 — local booking and admin flows are functional and protected, but lack of persistence remains a high-impact production risk.
