// script.js — Patient Portal & Admin Panel Logic (v2)

// --- Shared Toast ---
let tTimer;
function showToast(msg, type="info") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  const icons = { success:"✅", error:"❌", info:"ℹ️", warn:"⚠️" };
  const icon = document.createElement("span");
  icon.textContent = icons[type] || icons.info;
  toast.replaceChildren(icon, document.createTextNode(` ${msg}`));
  toast.className = `show ${type}`;
  clearTimeout(tTimer);
  tTimer = setTimeout(() => toast.className="", 3500);
}

// ==========================================
// PATIENT PORTAL LOGIC
// ==========================================
const form = document.getElementById("bookingForm");
if (form) {
  const btn  = document.getElementById("submitBtn");
  const docSelect = document.getElementById("doctorSelect");
  const dateInput = document.getElementById("appointmentDate");
  const slotSelect = document.getElementById("timeSlot");
  function formatSlotLabel(timeSlot) {
    return timeSlot.split("–").map(time => {
      const [hour, minute] = time.split(":").map(Number);
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
    }).join(" – ");
  }
  let availabilityRequest = 0;

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
      const query = new URLSearchParams({ doctor: docSelect.value, date: dateInput.value });
      const response = await fetch(`/availability?${query}`);
      const data = await response.json();
      if (requestId !== availabilityRequest) return;
      if (!response.ok) throw new Error(data.error || "Unable to load available times.");

      const placeholder = data.availableSlots.length
        ? "Select a slot"
        : "No slots available";
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
    const response = await fetch("/doctors");
    const doctors = await response.json();
    if (!response.ok) throw new Error(doctors.error || "Unable to load doctors.");

    docSelect.replaceChildren(new Option("Select a doctor", "", true, true));
    doctors.forEach(doctor => {
      const option = document.createElement("option");
      option.value = doctor.name;
      option.textContent = `${doctor.name} (${doctor.specialization})`;
      docSelect.appendChild(option);
    });
  }
  loadDoctors().catch(error => {
    docSelect.replaceChildren(new Option("Doctors unavailable", "", true, true));
    showToast(error.message, "error");
  });
  docSelect.addEventListener("change", loadAvailability);
  dateInput.addEventListener("change", loadAvailability);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name  = document.getElementById("patientName").value;
    const age   = document.getElementById("patientAge").value;
    const phone = document.getElementById("patientPhone").value;
    const date  = document.getElementById("appointmentDate").value;
    const doc   = document.getElementById("doctorSelect").value;
    const slot  = document.getElementById("timeSlot").value;
    const prob  = document.getElementById("patientProblem").value;

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Booking...`;

    try {
      const res = await fetch("/addPatient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, age:Number(age), phone, date, doctor:doc, timeSlot:slot, problem:prob })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Booking could not be completed.");

      localStorage.setItem("bookingId", data.booking.id);
      localStorage.setItem("bookingAccessToken", data.accessToken);
      window.location.href = "confirmation.html";

    } catch (err) {
      showToast(err.message || "Booking could not be completed.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `➕ Book Appointment`;
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
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return `Basic ${btoa(binary)}`;
  }

  function adminHeaders() {
    return { Authorization: authorizationHeader(adminPassword) };
  }

  async function signIn(password) {
    const response = await fetch("/admin/session", {
      headers: { Authorization: authorizationHeader(password) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Admin sign in failed.");

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

    const liveDate = document.getElementById("liveDate");
    liveDate.textContent = new Date().toLocaleDateString("en-IN", {
      weekday:"short", day:"numeric", month:"short", year:"numeric"
    });

    tabs.forEach(button => {
      button.addEventListener("click", () => {
        tabs.forEach(tab => tab.classList.remove("active"));
        button.classList.add("active");
        currentTab = button.dataset.tab;
        loadBookings();
      });
    });

    async function action(url, method="POST") {
      try {
        const response = await fetch(url, { method, headers: adminHeaders() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Admin action failed.");
        showToast(data.message, "success");
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
        const response = await fetch("/bookings", { headers: adminHeaders() });
        const all = await response.json();
        if (!response.ok) throw new Error(all.error || "Failed to load bookings.");

        const counts = {
          total: all.length,
          pending: all.filter(booking => booking.status === "pending").length,
          confirmed: all.filter(booking => booking.status === "confirmed").length,
          rejected: all.filter(booking => booking.status === "rejected").length,
          cancelled: all.filter(booking => booking.status === "cancelled").length,
        };
        Object.entries(counts).forEach(([status, count]) => {
          document.getElementById(`stat${status[0].toUpperCase()}${status.slice(1)}`).textContent = count;
          if (status !== "total") {
            document.getElementById(`count${status[0].toUpperCase()}${status.slice(1)}`).textContent = count;
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
      if (confirm("Reset ALL bookings? This cannot be undone.")) action("/reset");
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
      const headers = { "X-Booking-Token": accessToken };
      const res = await fetch(`/booking/${id}`, { headers });
      if (!res.ok) throw new Error();
      const b = await res.json();
      
      document.getElementById("loadingState").style.display = "none";
      confCard.style.display = "block";
      
      document.getElementById("confName").textContent = b.name;
      document.getElementById("confDoctor").textContent = b.doctor.name;
      document.getElementById("confDate").textContent = b.date;
      document.getElementById("confSlot").textContent = b.timeSlot;
      document.getElementById("confToken").textContent = `#${b.token}`;
      
      const st = document.getElementById("confStatus");
      st.textContent = b.status;
      st.className = `status-badge ${b.status}`;
      
      const pdfBtn = document.getElementById("downloadPdfBtn");
      const cancelBtn = document.getElementById("cancelBookingBtn");
      
      if (b.status === "confirmed") {
        pdfBtn.style.display = "inline-flex";
        pdfBtn.onclick = () => {
          const form = document.createElement("form");
          form.method = "POST";
          form.action = `/pdf/${b.id}`;
          form.hidden = true;

          const tokenInput = document.createElement("input");
          tokenInput.type = "hidden";
          tokenInput.name = "accessToken";
          tokenInput.value = accessToken;
          form.appendChild(tokenInput);
          document.body.appendChild(form);
          form.submit();
          form.remove();
        };
      } else {
        pdfBtn.style.display = "none";
        pdfBtn.onclick = null;
      }
      
      if (b.status === "cancelled" || b.status === "rejected") {
        cancelBtn.style.display = "none";
      } else {
        cancelBtn.style.display = "inline-flex";
        cancelBtn.onclick = async () => {
          if(!confirm("Are you sure you want to cancel this booking?")) return;
          cancelBtn.disabled = true;
          try {
            const cancelRes = await fetch(`/cancel/${b.id}`, { method: "POST", headers });
            const cancelData = await cancelRes.json();
            if (!cancelRes.ok) throw new Error(cancelData.error);
            showToast("Booking cancelled successfully", "success");
            await loadBooking();
          } catch(error) {
            showToast(error.message || "Cancellation failed.", "error");
          } finally {
            cancelBtn.disabled = false;
          }
        };
      }
    } catch(error) {
      document.getElementById("loadingState").style.display = "none";
      document.getElementById("errorState").style.display = "block";
    }
  };
  
  loadBooking();
}
