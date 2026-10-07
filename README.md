# ClinicQ

ClinicQ is a small Express application for booking clinic appointments and managing the patient queue.

## Run locally

Use Node.js 18 or later. Configure an administrator password of at least 12 characters before starting the server:

```sh
ADMIN_PASSWORD='replace-with-a-long-random-password' npm start
```

The server binds to `127.0.0.1` by default. The admin username is `admin`. The password is held only in the server environment and in the admin page's memory while it is open. The admin page asks for the password again after a reload. Do not expose this HTTP server directly to an untrusted network; use HTTPS when running behind a network-facing deployment. Set `HOST=0.0.0.0` only when the network-facing deployment terminates TLS before requests reach this app.

- Patient booking: `http://localhost:3000/`
- Admin panel: `http://localhost:3000/admin.html`

## Booking access

Patients can submit a booking without creating an account. A successful booking returns a random access token, which the patient page stores locally and sends in the `X-Booking-Token` header to view, cancel, or download that booking's PDF. Keep that token private; it grants access to the booking.

Administrative endpoints require HTTP Basic authentication using username `admin` and the configured `ADMIN_PASSWORD`. The doctors and slot-availability lists remain public and contain no patient data.

## Storage and time zone

Bookings are currently stored in memory, not in a database. They are lost when the server restarts. `database.js` is a placeholder; this application is not suitable for production use where appointment records must persist. Date and past-time validation use the server's local time zone; configure the server to the clinic's time zone.

## Tests

Run the API integration tests with:

```sh
npm test
```
