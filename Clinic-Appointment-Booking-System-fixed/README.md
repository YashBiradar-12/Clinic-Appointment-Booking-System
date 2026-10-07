# ClinicQ

ClinicQ is a small Express application for booking clinic appointments and managing the patient queue.

## Run locally

Use Node.js 18 or later. Configure an administrator password of at least 12 characters before starting the server:

```sh
ADMIN_PASSWORD='replace-with-a-long-random-password' npm start
```

The server binds to `127.0.0.1` by default.

- Patient booking: `http://localhost:3000/`
- Admin panel: `http://localhost:3000/admin.html`

## Storage

Bookings persist across server restarts in:

```text
data/bookings.json
```

The file is created automatically and written atomically. For tests or another deployment location, set:

```sh
BOOKINGS_FILE=/path/to/bookings.json
```

This is appropriate for a small single-instance portfolio/demo deployment. For a production multi-instance deployment, replace the JSON store with a managed transactional database.

## Booking access

Patients can submit a booking without creating an account. A successful booking returns a random access token, which the patient page stores locally and sends in the `X-Booking-Token` header to view, cancel, or download that booking's PDF. Keep that token private; it grants access to the booking.

Administrative endpoints require HTTP Basic authentication using username `admin` and the configured `ADMIN_PASSWORD`. The doctors and slot-availability lists remain public and contain no patient data.

## Deploying the frontend to GitHub Pages

GitHub Pages can host the static frontend, but it cannot run this Node.js backend.

The frontend therefore uses `config.js`:

```js
window.CLINICQ_API_BASE_URL = "";
```

For GitHub Pages, set it to the public HTTPS URL of your deployed backend:

```js
window.CLINICQ_API_BASE_URL = "https://your-backend.example.com";
```

Then configure the backend with the GitHub Pages origin:

```sh
CORS_ORIGIN=https://yashbiradar-12.github.io
```

If the repository is hosted at a project path such as `/Clinic-Appointment-Booking-System/`, the origin is still only:

```text
https://yashbiradar-12.github.io
```

The frontend no longer assumes that its API is on the same origin and gives a useful error instead of attempting to parse GitHub Pages' HTML as JSON.

For a network-facing backend, set:

```sh
HOST=0.0.0.0
PORT=3000
ADMIN_PASSWORD='replace-with-a-long-random-password'
CORS_ORIGIN='https://yashbiradar-12.github.io'
```

Use HTTPS at the hosting layer before exposing the backend publicly.

## Time zone

Date and past-time validation use the server's local time zone. Configure the backend host to the clinic's intended time zone.

## Tests

Run:

```sh
npm test
```

The regression suite covers doctor/slot APIs, validation, duplicate booking prevention, booking-token authorization, cancellation, admin transitions, PDF access, malformed JSON, and persistence across a simulated server restart.

## Important limitations

- The JSON store is single-instance storage; a managed database is recommended for production scale.
- Patient registration/login and multi-booking account history are not implemented.
- Rescheduling is not implemented.
- SMS notifications are simulated in the server console.
