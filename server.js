// server.js — ClinicQ v2 | In-Memory | Full Booking + Status + PDF

const express = require("express");
const path    = require("path");
const PDFDoc  = require("pdfkit");

const app  = express();
const PORT = 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
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

const VALID_SLOTS = ["9:00–10:00", "10:00–11:00", "11:00–12:00"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Find booking by ID
const findById = (id) => bookings.find(b => b.id === parseInt(id));

// Simulated SMS — prints to console (replace with Twilio/etc. for real SMS)
function sendSMS(phone, message) {
  console.log(`📱 SMS sent to ${phone}: ${message}`);
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET /doctors — Return available doctors list for the dropdown
app.get("/doctors", (req, res) => {
  res.json(DOCTORS);
});

// GET /bookings — Return all bookings (admin uses this)
app.get("/bookings", (req, res) => {
  res.json(bookings);
});

// GET /patients — Confirmed bookings sorted by token (queue view)
app.get("/patients", (req, res) => {
  const queue = bookings
    .filter(b => b.status === "confirmed")
    .sort((a, b) => a.token - b.token);
  res.json(queue);
});

// POST /addPatient — Create a new booking
app.post("/addPatient", (req, res) => {
  const { name, age, phone, problem, doctor: doctorName, date, timeSlot } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!name || !age || !phone || !problem || !doctorName || !date || !timeSlot) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (isNaN(age) || age < 1 || age > 120) {
    return res.status(400).json({ error: "Age must be between 1 and 120." });
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

  // ── Overlap Check ───────────────────────────────────────────────────────────
  // Block if same doctor + same date + same slot already exists (unless rejected)
  const overlap = bookings.find(b =>
    b.doctor.name === doctorName &&
    b.date        === date       &&
    b.timeSlot    === timeSlot   &&
    b.status      !== "rejected"
  );
  if (overlap) {
    return res.status(409).json({
      error: `⚠️ Slot already booked for ${doctorName} on ${date} at ${timeSlot}. Please choose another slot or doctor.`
    });
  }

  // ── Create Booking ──────────────────────────────────────────────────────────
  const booking = {
    id:       nextId++,
    token:    nextToken++,
    name:     name.trim(),
    age:      Number(age),
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
    booking,
  });
});

// POST /confirm/:id — Admin confirms a booking → sends simulated SMS
app.post("/confirm/:id", (req, res) => {
  const booking = findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  booking.status = "confirmed";

  // Simulated SMS notification
  sendSMS(
    booking.phone,
    `Your appointment with ${booking.doctor.name} on ${booking.date} at ${booking.timeSlot} is CONFIRMED. Token: #${booking.token}`
  );

  res.json({ message: "Booking confirmed and patient notified.", booking });
});

// POST /reject/:id — Admin rejects a booking → sends simulated SMS
app.post("/reject/:id", (req, res) => {
  const booking = findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  booking.status = "rejected";

  // Simulated SMS notification
  sendSMS(
    booking.phone,
    `Sorry, your appointment with ${booking.doctor.name} on ${booking.date} at ${booking.timeSlot} has been REJECTED. Please rebook.`
  );

  res.json({ message: "Booking rejected and patient notified.", booking });
});

// GET /booking/:id — Get details of a single booking
app.get("/booking/:id", (req, res) => {
  const booking = findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  res.json(booking);
});

// POST /cancel/:id — User cancels their booking
app.post("/cancel/:id", (req, res) => {
  const booking = findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  booking.status = "cancelled";
  res.json({ message: "Booking cancelled successfully.", booking });
});

// DELETE /next — Call next confirmed patient (removes from array)
app.delete("/next", (req, res) => {
  const idx = bookings.findIndex(b => b.status === "confirmed");
  if (idx === -1) {
    return res.status(404).json({ error: "No confirmed patients in queue." });
  }
  const called = bookings.splice(idx, 1)[0];
  res.json({
    message: `Patient "${called.name}" (Token #${called.token}) has been called.`,
    called,
  });
});

// GET /pdf/:id — Generate & stream appointment PDF (confirmed only)
app.get("/pdf/:id", (req, res) => {
  const b = findById(req.params.id);
  if (!b) return res.status(404).json({ error: "Booking not found." });
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
});

// POST /reset — Wipe all bookings and reset counters
app.post("/reset", (req, res) => {
  bookings  = [];
  nextToken = 1;
  nextId    = 1;
  console.log("🔁 All bookings have been reset.");
  res.json({ message: "All bookings have been reset successfully." });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
  console.log(`   Patient View : http://localhost:${PORT}/`);
  console.log(`   Admin Panel  : http://localhost:${PORT}/admin.html`);
});
