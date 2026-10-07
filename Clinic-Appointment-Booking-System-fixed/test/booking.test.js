const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.ADMIN_PASSWORD = "qa-test-password-2026";
process.env.BOOKINGS_FILE = path.join(
  os.tmpdir(),
  `clinicq-bookings-${process.pid}-${Date.now()}.json`
);
try { fs.rmSync(process.env.BOOKINGS_FILE, { force: true }); } catch {}
const app = require("../server");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let server;
let baseUrl;

function localDate(offsetDays = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function bookingData(overrides = {}) {
  return {
    name: "Test Patient",
    age: 28,
    phone: "1234567890",
    problem: "Routine check",
    doctor: "Dr. Priya Sharma",
    date: localDate(),
    timeSlot: "10:00–10:15",
    ...overrides,
  };
}

function authHeader(password = ADMIN_PASSWORD) {
  return `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.admin) headers.set("Authorization", authHeader(options.adminPassword));
  if (options.bookingToken) headers.set("X-Booking-Token", options.bookingToken);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, body };
}

async function createBooking(overrides) {
  return request("/addPatient", { method: "POST", body: bookingData(overrides) });
}

async function runTest(name, callback) {
  const { response } = await request("/reset", { method: "POST", admin: true });
  assert.equal(response.status, 200, "test setup could not clear persistent test data");
  await callback();
  console.log(`PASS ${name}`);
}

async function main() {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  let passed = 0;
  let failed = 0;

  const tests = [
    ["serves the portal, doctors, and future slot availability", async () => {
      const page = await request("/");
      assert.equal(page.response.status, 200);
      assert.match(page.body.toString(), /Book Your Appointment/);

      const doctors = await request("/doctors");
      assert.equal(doctors.response.status, 200);
      assert.equal(doctors.body.length, 4);
      assert.equal(doctors.body[0].name, "Dr. Priya Sharma");

      const availability = await request(`/availability?doctor=${encodeURIComponent("Dr. Priya Sharma")}&date=${localDate(1)}`);
      assert.equal(availability.response.status, 200);
      assert.deepEqual(availability.body.availableSlots, [
        "10:00–10:15", "10:15–10:30", "10:30–10:45", "10:45–11:00",
        "11:00–11:15", "11:15–11:30", "11:30–11:45", "11:45–12:00",
        "12:00–12:15", "12:15–12:30", "12:30–12:45", "12:45–13:00",
        "13:00–13:15", "13:15–13:30", "13:30–13:45", "13:45–14:00",
        "19:00–19:15", "19:15–19:30", "19:30–19:45", "19:45–20:00",
        "20:00–20:15", "20:15–20:30", "20:30–20:45", "20:45–21:00",
        "21:00–21:15", "21:15–21:30", "21:30–21:45", "21:45–22:00",
      ]);
      assert.equal((await request("/availability")).response.status, 400);
    }],
    ["validates request fields, doctor, date, and whole-number age", async () => {
      const invalidInputs = [
        null,
        {},
        bookingData({ name: 123 }),
        bookingData({ phone: 1234567890 }),
        bookingData({ name: "   " }),
        bookingData({ problem: "   " }),
        bookingData({ age: 28.5 }),
        bookingData({ doctor: "Dr. Priya Sharma (General Physician)" }),
        bookingData({ date: "not-a-date" }),
        bookingData({ date: "2027-02-30" }),
        bookingData({ date: localDate(-1) }),
      ];
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const pastSlot = [
        "10:00–10:15", "10:15–10:30", "10:30–10:45", "10:45–11:00",
        "11:00–11:15", "11:15–11:30", "11:30–11:45", "11:45–12:00",
        "12:00–12:15", "12:15–12:30", "12:30–12:45", "12:45–13:00",
        "13:00–13:15", "13:15–13:30", "13:30–13:45", "13:45–14:00",
        "19:00–19:15", "19:15–19:30", "19:30–19:45", "19:45–20:00",
        "20:00–20:15", "20:15–20:30", "20:30–20:45", "20:45–21:00",
        "21:00–21:15", "21:15–21:30", "21:30–21:45", "21:45–22:00",
      ]
        .find(slot => {
          const [hour, minute] = slot.split("–")[0].split(":").map(Number);
          return hour * 60 + minute <= currentMinutes;
        });
      if (pastSlot) invalidInputs.push(bookingData({ date: localDate(0), timeSlot: pastSlot }));
      for (const body of invalidInputs) {
        const result = await request("/addPatient", { method: "POST", body });
        assert.equal(result.response.status, 400, JSON.stringify(body));
        assert.equal(typeof result.body.error, "string");
      }
    }],
    ["creates a booking and never returns its access token in booking objects", async () => {
      const { response, body } = await createBooking();
      assert.equal(response.status, 201);
      assert.match(body.accessToken, /^[a-f0-9]{64}$/);
      assert.equal(body.booking.status, "pending");
      assert.equal(Object.hasOwn(body.booking, "accessToken"), false);
    }],
    ["availability and concurrent submissions prevent duplicate active slots", async () => {
      const input = bookingData({ date: localDate(2) });
      const results = await Promise.all([
        request("/addPatient", { method: "POST", body: input }),
        request("/addPatient", { method: "POST", body: input }),
      ]);
      assert.deepEqual(results.map(result => result.response.status).sort(), [201, 409]);

      const availability = await request(`/availability?doctor=${encodeURIComponent(input.doctor)}&date=${input.date}`);
      assert.equal(availability.body.availableSlots.includes(input.timeSlot), false);
    }],
    ["protects booking details and cancellation with the booking token", async () => {
      const created = await createBooking();
      const id = created.body.booking.id;

      assert.equal((await request(`/booking/${id}`)).response.status, 404);
      assert.equal((await request(`/booking/${id}`, { bookingToken: "incorrect" })).response.status, 404);
      assert.equal((await request(`/booking/${id}junk`, { bookingToken: created.body.accessToken })).response.status, 404);

      const details = await request(`/booking/${id}`, { bookingToken: created.body.accessToken });
      assert.equal(details.response.status, 200);
      assert.equal(details.body.name, "Test Patient");
      assert.equal(Object.hasOwn(details.body, "accessToken"), false);
      assert.equal((await request(`/cancel/${id}`, { method: "POST" })).response.status, 404);
    }],
    ["cancellation releases its slot and cannot be repeated or reversed", async () => {
      const input = bookingData({ date: localDate(3), timeSlot: "10:00–10:15" });
      const created = await request("/addPatient", { method: "POST", body: input });
      const id = created.body.booking.id;
      const token = created.body.accessToken;

      const cancelled = await request(`/cancel/${id}`, { method: "POST", bookingToken: token });
      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.body.booking.status, "cancelled");
      assert.equal((await request(`/cancel/${id}`, { method: "POST", bookingToken: token })).response.status, 409);
      assert.equal((await request(`/confirm/${id}`, { method: "POST", admin: true })).response.status, 409);

      const availability = await request(`/availability?doctor=${encodeURIComponent(input.doctor)}&date=${input.date}`);
      assert.equal(availability.body.availableSlots.includes(input.timeSlot), true);
      const replacement = await request("/addPatient", { method: "POST", body: input });
      assert.equal(replacement.response.status, 201);

      const rejected = await request(`/reject/${replacement.body.booking.id}`, { method: "POST", admin: true });
      assert.equal(rejected.response.status, 200);
      assert.equal(rejected.body.booking.status, "rejected");
      assert.equal((await request("/addPatient", { method: "POST", body: input })).response.status, 201);
    }],
    ["admin APIs require credentials and legal booking transitions", async () => {
      const created = await createBooking();
      const id = created.body.booking.id;

      assert.equal((await request("/bookings")).response.status, 401);
      assert.equal((await request("/bookings", { admin: true, adminPassword: "wrong" })).response.status, 401);
      assert.equal((await request("/admin/session")).response.status, 401);
      assert.equal((await request("/reset", { method: "POST" })).response.status, 401);
      const bookings = await request("/bookings", { admin: true });
      assert.equal(bookings.response.status, 200);
      assert.equal(bookings.body.length, 1);
      assert.equal(Object.hasOwn(bookings.body[0], "accessToken"), false);

      const confirmed = await request(`/confirm/${id}`, { method: "POST", admin: true });
      assert.equal(confirmed.response.status, 200);
      assert.equal(confirmed.body.booking.status, "confirmed");
      assert.equal((await request(`/confirm/${id}`, { method: "POST", admin: true })).response.status, 409);
      assert.equal((await request(`/reject/${id}`, { method: "POST", admin: true })).response.status, 409);

      const queue = await request("/patients", { admin: true });
      assert.equal(queue.response.status, 200);
      assert.equal(queue.body.length, 1);
      assert.equal((await request("/next", { method: "DELETE", admin: true })).response.status, 200);
      assert.equal((await request("/next", { method: "DELETE", admin: true })).response.status, 404);
    }],
    ["PDF requires the booking token and a confirmed appointment", async () => {
      const created = await createBooking();
      const id = created.body.booking.id;
      const token = created.body.accessToken;

      assert.equal((await request(`/pdf/${id}`)).response.status, 404);
      assert.equal((await request(`/pdf/${id}`, { bookingToken: token })).response.status, 400);
      assert.equal((await request(`/confirm/${id}`, { method: "POST", admin: true })).response.status, 200);

      const pdf = await request(`/pdf/${id}`, { bookingToken: token });
      assert.equal(pdf.response.status, 200);
      assert.match(pdf.response.headers.get("content-type"), /application\/pdf/);
      assert.equal(pdf.body.subarray(0, 4).toString(), "%PDF");

      const formPdf = await request(`/pdf/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        rawBody: new URLSearchParams({ accessToken: token }).toString(),
      });
      assert.equal(formPdf.response.status, 200);
      assert.equal(formPdf.body.subarray(0, 4).toString(), "%PDF");
    }],
    ["malformed JSON returns a JSON 400 without a stack trace", async () => {
      const result = await request("/addPatient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        rawBody: "{invalid",
      });
      assert.equal(result.response.status, 400);
      assert.equal(result.body.error, "Invalid JSON request body.");
      assert.equal(JSON.stringify(result.body).includes("server.js"), false);
    }],
    ["bookings persist across a server restart", async () => {
      const input = bookingData({ date: localDate(4), timeSlot: "10:15–10:30" });
      const created = await request("/addPatient", { method: "POST", body: input });
      assert.equal(created.response.status, 201);
      const bookingId = created.body.booking.id;

      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

      delete require.cache[require.resolve("../server")];
      const restartedApp = require("../server");
      server = restartedApp.listen(0, "127.0.0.1");
      await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;

      const afterRestart = await request("/booking/" + bookingId, {
        bookingToken: created.body.accessToken,
      });
      assert.equal(afterRestart.response.status, 200);
      assert.equal(afterRestart.body.id, bookingId);
      assert.equal(afterRestart.body.status, "pending");

      const adminBookings = await request("/bookings", { admin: true });
      assert.equal(adminBookings.response.status, 200);
      assert.equal(adminBookings.body.some(booking => booking.id === bookingId), true);
    }],
  ];

  try {
    for (const [name, callback] of tests) {
      try {
        await runTest(name, callback);
        passed++;
      } catch (error) {
        failed++;
        console.error(`FAIL ${name}: ${error.stack || error.message}`);
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
