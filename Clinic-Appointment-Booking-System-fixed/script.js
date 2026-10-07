// script.js — ClinicQ patient portal, confirmation page, and admin panel.

const API_BASE_URL = String(window.CLINICQ_API_BASE_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function apiJson(path, options = {}) {
  let response;
  try {
    response = await fetch(apiUrl(path), options);
  } catch {
    throw new Error("Unable to reach the ClinicQ server. Check the backend URL and that the server is running.");
  }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (!contentType.includes("application/json")) {
        throw new Error(
          `ClinicQ backend returned ${response.status} ${response.statusText || "without JSON data"}. Check the configured API URL.`
        );
      }
      throw new Error("ClinicQ backend returned invalid JSON.");
    }
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with HTTP ${response.status}.`);
  }

  return { response, data };
}

// --- Shared Toast ---
let tTimer;
function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  const icons = { success: "✅", error: "❌", info: "ℹ️", warn: "⚠️" };
  const icon = document.createElement("span");
  icon.textContent = icons[type] || icons.info;
  toast.replaceChildren(icon, document.createTextNode(` ${msg}`));
  toast.className = `show ${type}`;
  clearTimeout(tTimer);
  tTimer = setTimeout(() => { toast.className = ""; }, 3500);
}

// ==========================================
// PATIENT PORTAL LOGIC
// ==========================================
const form = document.getElementById("bookingForm");

if (form) {
  const btn = document.getElementById("submitBtn");
  const docSelect = document.getElementById("doctorSelect");
  const dateInput = document.getElementById("appointmentDate");
  const slotSelect = document.getElementById("timeSlot");
  let availabilityRequest = 0;

  function formatSlotLabel(timeSlot) {
    return timeSlot.split("–").map(time => {
      const [hour, minute] = time.split(":").map(Number);
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
    }).join(" – ");
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  dateInput.min = localDateString(new Date());

  async function loadAvailability() {
    const requestId = ++availabilityRequest;
    slotSelect.replaceChildren(new Option("Select a date and doctor first", "", true, true));

    if (!dateInput.value || !docSelect.value) return;

    try {
      const query = new URLSearchParams({
        doctor: docSelect.value,
        date: dateInput.value,
      });
      const { data } = await apiJson(`/availability?${query}`);
      if (requestId !== availabilityRequest) return;

      const placeholder = data.availableSlots.length ? "Select a slot" : "No slots available";
      slotSelect.replaceChildren(new Option(placeholder, "", true, true));

      data.availableSlots.forEach(timeSlot => {
        const option = document.createElement("option");
        option.value = timeSlot;
        option.textContent = formatSlotLabel(timeSlot);
        slotSelect.appendChild(option);
      });
    } catch (error) {
      if (requestId !== availabilityRequest) return;
      slotSelect.replaceChildren(new Option("Availability unavailable", "", true, true));
      showToast(error.message || "Unable to load available times.", "error");
    }
  }

  async function loadDoctors() {
    try {
      const { data: doctors } = await apiJson("/doctors");
      docSelect.replaceChildren(new Option("Select a doctor", "", true, true));

      doctors.forEach(doctor => {
        const option = document.createElement("option");
        option.value = doctor.name;
        option.textContent = `${doctor.name} (${doctor.specialization})`;
        docSelect.appendChild(option);
      });
    } catch (error) {
      docSelect.replaceChildren(new Option("Doctors unavailable", "", true, true));
      showToast(error.message || "Unable to load doctors.", "error");
    }
  }

  loadDoctors();
  docSelect.addEventListener("change", loadAvailability);
  dateInput.addEventListener("change", loadAvailability);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const name = document.getElementById("patientName").value.trim();
    const age = Number(document.getElementById("patientAge").value);
    const phone = document.getElementById("patientPhone").value.trim();
    const date = dateInput.value;
    const doctor = docSelect.value;
    const timeSlot = slotSelect.value;
    const problem = document.getElementById("patientProblem").value.trim();

    if (!doctor || !timeSlot) {
      showToast("Please select a doctor and available time slot.", "error");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Booking...`;

    try {
      const { data } = await apiJson("/addPatient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, age, phone, date, doctor, timeSlot, problem }),
      });

      localStorage.setItem("bookingId", data.booking.id);
      localStorage.setItem("bookingAccessToken", data.accessToken);
      window.location.href = new URL("confirmation.html", window.location.href).href;
    } catch (error) {
      showToast(error.message || "Booking could not be completed.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "➕ Book Appointment";
    }
  });
}

// ==========================================
// ADMIN PANEL LOGIC
// ==========================================
const adminLoginForm = document.getElementById("adminLoginForm");

if (adminLoginForm) {
  const loginPanel = document.getElementById("adminLogin");
  const adminPanel = document.getElementById("adminPanel");
  const loginError = document.getElementById("adminLoginError");
  const loginButton = document.getElementById("adminLoginBtn");
  let adminPassword = "";
  let refreshTimer;

  function authorizationHeader(password) {
    const bytes = new TextEncoder().encode(`admin:${password}`);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return `Basic ${btoa(binary)}`;
  }

  function adminHeaders() {
    return { Authorization: authorizationHeader(adminPassword) };
  }

  async function signIn(password) {
    const { data } = await apiJson("/admin/session", {
      headers: { Authorization: authorizationHeader(password) },
    });

    if (!data.authenticated) {
      throw new Error("Admin sign in failed.");
    }

    adminPassword = password;
    loginError.textContent = "";
    loginPanel.hidden = true;
    adminPanel.hidden = false;
    initializeAdminPanel();
  }

  adminLoginForm.addEventListener("submit", async event => {
    event.preventDefault();
    loginButton.disabled = true;
    loginError.textContent = "";

    try {
      await signIn(document.getElementById("adminPassword").value);
    } catch (error) {
      loginError.textContent = error.message || "Unable to sign in.";
    } finally {
      loginButton.disabled = false;
    }
  });

  function initializeAdminPanel() {
    const list = document.getElementById("bookingsList");
    const tabs = document.querySelectorAll(".tab-btn");
    let currentTab = "pending";

    document.getElementById("liveDate").textContent = new Date().toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    tabs.forEach(button => {
      button.addEventListener("click", () => {
        tabs.forEach(tab => tab.classList.remove("active"));
        button.classList.add("active");
        currentTab = button.dataset.tab;
        loadBookings();
      });
    });

    async function action(path, method = "POST") {
      try {
        const { data } = await apiJson(path, {
          method,
          headers: adminHeaders(),
        });
        showToast(data.message || "Action completed.", "success");
        await loadBookings();
      } catch (error) {
        showToast(error.message || "Admin action failed.", "error");
      }
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]);
    }

    async function loadBookings() {
      try {
        const { data: all } = await apiJson("/bookings", {
          headers: adminHeaders(),
        });

        const counts = {
          total: all.length,
          pending: all.filter(booking => booking.status === "pending").length,
          confirmed: all.filter(booking => booking.status === "confirmed").length,
          rejected: all.filter(booking => booking.status === "rejected").length,
          cancelled: all.filter(booking => booking.status === "cancelled").length,
        };

        Object.entries(counts).forEach(([status, count]) => {
          const stat = document.getElementById(`stat${status[0].toUpperCase()}${status.slice(1)}`);
          if (stat) stat.textContent = count;

          if (status !== "total") {
            const tabCount = document.getElementById(`count${status[0].toUpperCase()}${status.slice(1)}`);
            if (tabCount) tabCount.textContent = count;
          }
        });

        list.replaceChildren();
        const filtered = all.filter(booking => booking.status === currentTab);

        if (filtered.length === 0) {
          const empty = document.createElement("li");
          empty.className = "empty-state";
          empty.innerHTML = `<div class="empty-icon">🪑</div><p>No ${escapeHtml(currentTab)} bookings.</p>`;
          list.appendChild(empty);
          return;
        }

        filtered.forEach(booking => {
          const status = ["pending", "confirmed", "rejected", "cancelled"].includes(booking.status)
            ? booking.status
            : "unknown";
          const doctorName = booking.doctor?.name || "Unknown doctor";
          const specialization = booking.doctor?.specialization || "Unknown specialization";

          const card = document.createElement("li");
          card.className = "booking-card";
          card.innerHTML = `
            <div class="booking-header">
              <div class="token-badge">#${escapeHtml(booking.token)}</div>
              <div class="booking-primary">
                <div class="booking-name">${escapeHtml(booking.name)} <span class="booking-meta">· Age ${escapeHtml(booking.age)} · 📞 ${escapeHtml(booking.phone)}</span></div>
                <div class="booking-meta">🩺 ${escapeHtml(doctorName)} (${escapeHtml(specialization)})</div>
              </div>
              <div class="status-badge ${status}">${status}</div>
            </div>
            <div class="booking-details">
              <span><b>Date:</b> ${escapeHtml(booking.date)}</span>
              <span><b>Slot:</b> ${escapeHtml(booking.timeSlot)}</span>
              <span><b>Problem:</b> ${escapeHtml(booking.problem)}</span>
              <span><b>Booked At:</b> ${escapeHtml(booking.bookedAt)}</span>
            </div>
            <div class="booking-actions"></div>
          `;

          const actions = card.querySelector(".booking-actions");
          if (status === "pending") {
            const confirmButton = document.createElement("button");
            confirmButton.className = "btn btn-sm btn-success";
            confirmButton.textContent = "✅ Confirm";
            confirmButton.addEventListener("click", () => action(`/confirm/${booking.id}`));

            const rejectButton = document.createElement("button");
            rejectButton.className = "btn btn-sm btn-danger";
            rejectButton.textContent = "❌ Reject";
            rejectButton.addEventListener("click", () => action(`/reject/${booking.id}`));

            actions.append(confirmButton, rejectButton);
          }

          list.appendChild(card);
        });
      } catch (error) {
        showToast(error.message || "Failed to load bookings.", "error");
      }
    }

    document.getElementById("callNextBtn").addEventListener("click", () => action("/next", "DELETE"));

    document.getElementById("resetBtn").addEventListener("click", () => {
      if (confirm("Reset ALL bookings? This cannot be undone.")) {
        action("/reset");
      }
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
      adminPassword = "";
      clearInterval(refreshTimer);
      window.location.reload();
    });

    loadBookings();
    refreshTimer = setInterval(loadBookings, 5000);
  }
}

// ==========================================
// CONFIRMATION PAGE LOGIC
// ==========================================
const confCard = document.getElementById("confirmationCard");

if (confCard) {
  const loadBooking = async () => {
    const id = localStorage.getItem("bookingId");
    const accessToken = localStorage.getItem("bookingAccessToken");

    if (!id || !accessToken) {
      document.getElementById("loadingState").style.display = "none";
      document.getElementById("errorState").style.display = "block";
      return;
    }

    try {
      const { data: booking } = await apiJson(`/booking/${encodeURIComponent(id)}`, {
        headers: { "X-Booking-Token": accessToken },
      });

      document.getElementById("loadingState").style.display = "none";
      confCard.style.display = "block";

      document.getElementById("confName").textContent = booking.name;
      document.getElementById("confDoctor").textContent = booking.doctor.name;
      document.getElementById("confDate").textContent = booking.date;
      document.getElementById("confSlot").textContent = booking.timeSlot;
      document.getElementById("confToken").textContent = `#${booking.token}`;

      const statusElement = document.getElementById("confStatus");
      statusElement.textContent = booking.status;
      statusElement.className = `status-badge ${booking.status}`;

      const pdfButton = document.getElementById("downloadPdfBtn");
      const cancelButton = document.getElementById("cancelBookingBtn");

      if (booking.status === "confirmed") {
        pdfButton.style.display = "inline-flex";
        pdfButton.onclick = () => {
          const downloadForm = document.createElement("form");
          downloadForm.method = "POST";
          downloadForm.action = apiUrl(`/pdf/${encodeURIComponent(booking.id)}`);
          downloadForm.hidden = true;

          const tokenInput = document.createElement("input");
          tokenInput.type = "hidden";
          tokenInput.name = "accessToken";
          tokenInput.value = accessToken;

          downloadForm.appendChild(tokenInput);
          document.body.appendChild(downloadForm);
          downloadForm.submit();
          downloadForm.remove();
        };
      } else {
        pdfButton.style.display = "none";
        pdfButton.onclick = null;
      }

      if (booking.status === "cancelled" || booking.status === "rejected") {
        cancelButton.style.display = "none";
      } else {
        cancelButton.style.display = "inline-flex";
        cancelButton.onclick = async () => {
          if (!confirm("Are you sure you want to cancel this booking?")) return;

          cancelButton.disabled = true;
          try {
            const { data } = await apiJson(`/cancel/${encodeURIComponent(booking.id)}`, {
              method: "POST",
              headers: { "X-Booking-Token": accessToken },
            });
            showToast(data.message || "Booking cancelled successfully.", "success");
            await loadBooking();
          } catch (error) {
            showToast(error.message || "Cancellation failed.", "error");
          } finally {
            cancelButton.disabled = false;
          }
        };
      }
    } catch {
      document.getElementById("loadingState").style.display = "none";
      document.getElementById("errorState").style.display = "block";
    }
  };

  loadBooking();
}
