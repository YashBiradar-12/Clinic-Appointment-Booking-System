// database.js — Persistent JSON storage for ClinicQ.
//
// This keeps the project dependency-free while making bookings survive
// server restarts. Writes are atomic (temporary file + rename) so a failed
// write does not leave a partially-written bookings file.

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.BOOKINGS_FILE
  ? path.resolve(process.env.BOOKINGS_FILE)
  : path.join(__dirname, "data", "bookings.json");

function emptyState() {
  return { bookings: [], nextToken: 1, nextId: 1 };
}

function ensureDirectory() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return emptyState();

  const bookings = Array.isArray(raw.bookings) ? raw.bookings : [];
  const maxId = bookings.reduce((max, booking) =>
    Number.isSafeInteger(booking?.id) ? Math.max(max, booking.id) : max, 0);
  const maxToken = bookings.reduce((max, booking) =>
    Number.isSafeInteger(booking?.token) ? Math.max(max, booking.token) : max, 0);

  return {
    bookings,
    nextId: Number.isSafeInteger(raw.nextId) && raw.nextId > maxId
      ? raw.nextId
      : maxId + 1,
    nextToken: Number.isSafeInteger(raw.nextToken) && raw.nextToken > maxToken
      ? raw.nextToken
      : maxToken + 1,
  };
}

function loadState() {
  ensureDirectory();

  if (!fs.existsSync(DATA_FILE)) {
    const state = emptyState();
    saveState(state);
    return state;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return normalizeState(raw);
  } catch (error) {
    throw new Error(`Unable to read booking database at ${DATA_FILE}: ${error.message}`);
  }
}

function saveState(state) {
  ensureDirectory();
  const normalized = normalizeState(state);
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(normalized, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryFile, DATA_FILE);
  } catch (error) {
    try { fs.rmSync(temporaryFile, { force: true }); } catch {}
    throw new Error(`Unable to save booking database at ${DATA_FILE}: ${error.message}`);
  }

  return normalized;
}

function resetState() {
  const state = emptyState();
  saveState(state);
  return state;
}

module.exports = {
  DATA_FILE,
  loadState,
  saveState,
  resetState,
};
