// server.js — ClinicQ v2 | In-Memory | Full Booking + Status + PDF

const express = require("express");
const crypto  = require("crypto");
const PDFDoc  = require("pdfkit");

const app  = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD_MIN_LENGTH = 12;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(express.static(__dirname));

// ─── In-Memory Storage ────────────────────────────────────────────────────────
let bookings  = [];   // All bookings
let nextToken = 1;    // Auto-incrementing token
let nextId    = 1;    // Auto-incrementing booking ID

// ─── Constants ────────────────────────────────────────────────────────────────
const DOCTORS = [
  { name: "Dr. Priya Sharma",  specialization: "General Physician" },
  { name: "Dr. Arjun Mehta",   specialization: "Orthopedics"       },
  { name: "Dr. Sneha Rao",     specialization: "Dermatology"       },
  { name: "Dr. Vikram Nair",   specialization: "Cardiology"        },
];

function createSlots(startHour, endHour) {
  const formatTime = minutes =>
    `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  const slots = [];

  for (let start = startHour * 60; start < endHour * 60; start += 15) {
    slots.push(`${formatTime(start)}–${formatTime(start + 15)}`);
  }
  return slots;
}

const VALID_SLOTS = [...createSlots(10, 14), ...createSlots(19, 22)];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function constantTimeEquals(left, right) {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function findById(id) {
  if (!/^\d+$/.test(id)) return undefined;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId)) return undefined;
  return bookings.find(b => b.id === numericId);
}

function publicBooking({ accessToken, ...booking }) {
  return booking;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return res.status(503).json({ error: "Admin access is disabled. Configure an ADMIN_PASSWORD of at least 12 characters." });
  }

  const match = (req.get("authorization") || "").match(/^Basic\s+(.+)$/i);
  if (match) {
    const credentials = Buffer.from(match[1], "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);
    if (separator > 0 && username === "admin" && constantTimeEquals(password, ADMIN_PASSWORD)) {
      return next();
    }
  }

  return res.status(401).json({ error: "Admin authentication required." });
}

function hasBookingAccess(req, booking, allowFormToken = false) {
  const accessToken = req.get("x-booking-token") ||
    (allowFormToken && typeof req.body?.accessToken === "string" ? req.body.accessToken : undefined);
  return typeof accessToken === "string" && constantTimeEquals(accessToken, booking.accessToken);
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Enter a valid appointment date.";

  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  if (
    year < 1000 ||
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return "Enter a valid appointment date.";
  }

  const now = new Date();
  const today = getLocalDateString(now);
  if (date < today) return "Appointment date cannot be in the past.";
  return null;
}

function isSlotInThePast(date, timeSlot, now = new Date()) {
  if (date !== getLocalDateString(now)) return false;
  const [hour, minute] = timeSlot.split("–")[0].split(":").map(Number);
  return hour * 60 + minute <= now.getHours() * 60 + now.getMinutes();
}

function validateAppointmentDate(date, timeSlot) {
  const dateError = validateDate(date);
  if (dateError) return dateError;
  if (isSlotInThePast(date, timeSlot)) {
    return "Appointment time cannot be in the past.";
  }
  return null;
}

// Simulated SMS — prints to console (replace with Twilio/etc. for real SMS)
function sendSMS(phone, message) {
  console.log(`📱 SMS sent to ${phone}: ${message}`);
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET /admin/session — Validate the admin password entered by the admin panel
app.get("/admin/session", requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

// GET /doctors — Return available doctors list for the dropdown
app.get("/doctors", (req, res) => {
  res.json(DOCTORS);
});

// GET /availability?doctor=...&date=... — Return unreserved future slots
app.get("/availability", (req, res) => {
  const { doctor: doctorName, date } = req.query;
  if (typeof doctorName !== "string" || typeof date !== "string") {
    return res.status(400).json({ error: "Doctor and date are required." });
  }
  if (!DOCTORS.some(doctor => doctor.name === doctorName)) {
    return res.status(400).json({ error: "Invalid doctor selected." });
  }
  const dateError = validateDate(date);
  if (dateError) return res.status(400).json({ error: dateError });

  const availableSlots = VALID_SLOTS.filter(timeSlot =>
    !isSlotInThePast(date, timeSlot) &&
    !bookings.some(booking =>
      booking.doctor.name === doctorName &&
      booking.date === date &&
      booking.timeSlot === timeSlot &&
      (booking.status === "pending" || booking.status === "confirmed")
    )
  );
  res.json({ availableSlots });
});

// GET /bookings — Return all bookings (admin uses this)
app.get("/bookings", requireAdmin, (req, res) => {
  res.json(bookings.map(publicBooking));
});

// GET /patients — Confirmed bookings sorted by token (queue view)
app.get("/patients", requireAdmin, (req, res) => {
  const queue = bookings
    .filter(b => b.status === "confirmed")
    .sort((a, b) => a.token - b.token)
    .map(publicBooking);
  res.json(queue);
});

// POST /addPatient — Create a new booking
app.post("/addPatient", (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
  const { name, age, phone, problem, doctor: doctorName, date, timeSlot } = body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (
    typeof name !== "string" || !name.trim() ||
    (typeof age !== "number" && typeof age !== "string") ||
    typeof phone !== "string" || !phone.trim() ||
    typeof problem !== "string" || !problem.trim() ||
    typeof doctorName !== "string" ||
    typeof date !== "string" ||
    typeof timeSlot !== "string"
  ) {
    return res.status(400).json({ error: "All fields are required." });
  }
  const numericAge = Number(age);
  if (!Number.isInteger(numericAge) || numericAge < 1 || numericAge > 120) {
    return res.status(400).json({ error: "Age must be a whole number between 1 and 120." });
  }
  if (!/^\d{10}$/.test(phone.replace(/\s/g, ""))) {
    return res.status(400).json({ error: "Enter a valid 10-digit phone number." });
  }
  if (!VALID_SLOTS.includes(timeSlot)) {
    return res.status(400).json({ error: "Invalid time slot selected." });
  }
  const doctor = DOCTORS.find(d => d.name === doctorName);
  if (!doctor) {
    return res.status(400).json({ error: "Invalid doctor selected." });
  }
  const dateError = validateAppointmentDate(date, timeSlot);
  if (dateError) return res.status(400).json({ error: dateError });

  // ── Overlap Check ───────────────────────────────────────────────────────────
  // Rejected and cancelled bookings no longer reserve the slot.
  const overlap = bookings.find(b =>
    b.doctor.name === doctorName &&
    b.date        === date       &&
    b.timeSlot    === timeSlot   &&
    (b.status === "pending" || b.status === "confirmed")
  );
  if (overlap) {
    return res.status(409).json({
      error: `⚠️ Slot already booked for ${doctorName} on ${date} at ${timeSlot}. Please choose another slot or doctor.`
    });
  }

  // ── Create Booking ──────────────────────────────────────────────────────────
  const accessToken = crypto.randomBytes(32).toString("hex");
  const booking = {
    id:       nextId++,
    token:    nextToken++,
    accessToken,
    name:     name.trim(),
    age:      numericAge,
    phone:    phone.trim(),
    problem:  problem.trim(),
    doctor,                   // { name, specialization }
    date,
    timeSlot,
    status:   "pending",      // Default status
    bookedAt: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  };

  bookings.push(booking);

  res.status(201).json({
    message: "Booking submitted! Your status is Pending. Please wait for confirmation.",
    booking: publicBooking(booking),
    accessToken,
  });
});

// POST /confirm/:id — Admin confirms a booking → sends simulated SMS
app.post("/confirm/:id", requireAdmin, (req, res) => {
  const booking = findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (booking.status !== "pending") {
    return res.status(409).json({ error: "Only pending bookings can be confirmed." });
  }

  booking.status = "confirmed";

  // Simulated SMS notification
  sendSMS(
    booking.phone,
    `Your appointment with ${booking.doctor.name} on ${booking.date} at ${booking.timeSlot} is CONFIRMED. Token: #${booking.token}`
  );

  res.json({ message: "Booking confirmed and patient notified.", booking: publicBooking(booking) });
});

// POST /reject/:id — Admin rejects a booking → sends simulated SMS
app.post("/reject/:id", requireAdmin, (req, res) => {
  const booking = findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (booking.status !== "pending") {
    return res.status(409).json({ error: "Only pending bookings can be rejected." });
  }

  booking.status = "rejected";

  // Simulated SMS notification
  sendSMS(
    booking.phone,
    `Sorry, your appointment with ${booking.doctor.name} on ${booking.date} at ${booking.timeSlot} has been REJECTED. Please rebook.`
  );

  res.json({ message: "Booking rejected and patient notified.", booking: publicBooking(booking) });
});

// GET /booking/:id — Get details of a single booking
app.get("/booking/:id", (req, res) => {
  const booking = findById(req.params.id);
  if (!booking || !hasBookingAccess(req, booking)) {
    return res.status(404).json({ error: "Booking not found." });
  }
  res.json(publicBooking(booking));
});

// POST /cancel/:id — User cancels their booking
app.post("/cancel/:id", (req, res) => {
  const booking = findById(req.params.id);
  if (!booking || !hasBookingAccess(req, booking)) {
    return res.status(404).json({ error: "Booking not found." });
  }
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return res.status(409).json({ error: "Only pending or confirmed bookings can be cancelled." });
  }

  booking.status = "cancelled";
  res.json({ message: "Booking cancelled successfully.", booking: publicBooking(booking) });
});

// DELETE /next — Call next confirmed patient (removes from array)
app.delete("/next", requireAdmin, (req, res) => {
  const idx = bookings.findIndex(b => b.status === "confirmed");
  if (idx === -1) {
    return res.status(404).json({ error: "No confirmed patients in queue." });
  }
  const called = bookings.splice(idx, 1)[0];
  res.json({
    message: `Patient "${called.name}" (Token #${called.token}) has been called.`,
    called: publicBooking(called),
  });
});

// GET /pdf/:id and POST /pdf/:id — Generate & stream appointment PDF (confirmed only)
function sendBookingPdf(req, res) {
  const booking = findById(req.params.id);
  if (!booking || !hasBookingAccess(req, booking, req.method === "POST")) {
    return res.status(404).json({ error: "Booking not found." });
  }
  const b = booking;
  if (b.status !== "confirmed") {
    return res.status(400).json({ error: "PDF is only available for confirmed bookings." });
  }

  // Set response headers so browser downloads the file
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=appointment-token-${b.token}.pdf`);

  // ── Build PDF ────────────────────────────────────────────────────────────────
  const doc = new PDFDoc({ margin: 55, size: "A4" });
  doc.pipe(res); // Stream PDF directly to response

  const TEAL  = "#2dd4bf";
  const DARK  = "#111827";
  const MUTED = "#6b7280";

  // Header
  doc.rect(0, 0, doc.page.width, 100).fill(DARK);
  doc.fontSize(26).fillColor(TEAL).text("ClinicQ", 55, 28);
  doc.fontSize(11).fillColor("#9ca3af").text("Appointment Confirmation", 55, 60);
  doc.moveDown(3);

  // Divider
  doc.moveTo(55, doc.y).lineTo(540, doc.y).strokeColor(TEAL).lineWidth(1.5).stroke();
  doc.moveDown(1.2);

  // Token highlight box
  doc.roundedRect(55, doc.y, 480, 48, 8).fill("#f0fdfa");
  doc.fontSize(13).fillColor(DARK).text(`Token Number:`, 75, doc.y - 38, { continued: true });
  doc.fontSize(16).fillColor(TEAL).text(`  #${b.token}`, { continued: false });
  doc.moveDown(1.5);

  // Patient details table
  const rows = [
    ["Patient Name",   b.name],
    ["Age",            `${b.age} years`],
    ["Phone",          b.phone],
    ["Problem",        b.problem],
    ["Doctor",         b.doctor.name],
    ["Specialization", b.doctor.specialization],
    ["Date",           b.date],
    ["Time Slot",      b.timeSlot],
    ["Status",         "✓ Confirmed"],
    ["Booked At",      b.bookedAt],
  ];

  rows.forEach(([label, value], i) => {
    const y = doc.y;
    if (i % 2 === 0) doc.rect(55, y - 4, 480, 26).fill("#f9fafb");
    doc.fontSize(10).fillColor(MUTED).text(label, 70, y, { width: 160 });
    doc.fontSize(10).fillColor(DARK).text(value, 230, y, { width: 290 });
    doc.moveDown(0.75);
  });

  // Footer
  doc.moveDown(2);
  doc.moveTo(55, doc.y).lineTo(540, doc.y).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fontSize(9).fillColor(MUTED)
     .text("Please arrive 10 minutes before your scheduled appointment.", { align: "center" })
     .text("Carry a valid ID and this confirmation slip.", { align: "center" })
     .moveDown(0.4)
     .text("ClinicQ — Clinic Queue Management System", { align: "center" });

  doc.end();
}

app.get("/pdf/:id", sendBookingPdf);
app.post("/pdf/:id", sendBookingPdf);

// POST /reset — Wipe all bookings and reset counters
app.post("/reset", requireAdmin, (req, res) => {
  bookings  = [];
  nextToken = 1;
  nextId    = 1;
  console.log("🔁 All bookings have been reset.");
  res.json({ message: "All bookings have been reset successfully." });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
    ? err.status
    : 500;
  if (status >= 500) console.error(err);

  let message = status >= 500 ? "Internal server error." : "Request failed.";
  if (err.type === "entity.parse.failed") message = "Invalid JSON request body.";
  if (err.type === "entity.too.large") message = "Request body is too large.";
  res.status(status).json({ error: message });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`✅ Server running → http://localhost:${PORT}`);
    console.log(`   Patient View : http://localhost:${PORT}/`);
    console.log(`   Admin Panel  : http://localhost:${PORT}/admin.html`);
    if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < ADMIN_PASSWORD_MIN_LENGTH) {
      console.warn("⚠️ Admin APIs are disabled until ADMIN_PASSWORD has at least 12 characters.");
    }
  });
}

module.exports = app;
