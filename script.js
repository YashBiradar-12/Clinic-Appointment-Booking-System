// script.js — Patient Portal & Admin Panel Logic (v2)

// --- Shared Toast ---
let tTimer;
function showToast(msg, type="info") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  const icons = { success:"✅", error:"❌", info:"ℹ️", warn:"⚠️" };
  toast.innerHTML = `<span>${icons[type]}</span> ${msg}`;
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
  // Removed banner references as we redirect to confirmation page

  async function loadDoctors() {
    try {
      const res = await fetch("/doctors");
      const docs = await res.json();
      docSelect.innerHTML = `<option value="" disabled selected>Select a doctor</option>`;
      docs.forEach(d => {
        docSelect.innerHTML += `<option value="${d.name}">${d.name} (${d.specialization})</option>`;
      });
    } catch (e) {
      showToast("Failed to load doctors.", "error");
    }
  }
  loadDoctors();

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

      if (!res.ok) throw new Error(data.error);

      localStorage.setItem("bookingId", data.booking.id);
      window.location.href = "confirmation.html";
      showToast("Booking submitted! Waiting for confirmation.", "success");

    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `➕ Book Appointment`;
    }
  });
}

// ==========================================
// ADMIN PANEL LOGIC
// ==========================================
const list = document.getElementById("bookingsList");
if (list) {
  const tabs = document.querySelectorAll(".tab-btn");
  let currentTab = "pending";

  const liveDate = document.getElementById("liveDate");
  if(liveDate) {
    liveDate.textContent = new Date().toLocaleDateString("en-IN", {
      weekday:"short", day:"numeric", month:"short", year:"numeric"
    });
  }

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab;
      loadBookings();
    });
  });

  async function action(url, method="POST") {
    try {
      const res = await fetch(url, { method });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message, "success");
      loadBookings();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  window.action = action; // Expose to global for inline onclick

  async function loadBookings() {
    try {
      const res = await fetch("/bookings");
      let all = await res.json();

      document.getElementById("statTotal").textContent = all.length;
      document.getElementById("statPending").textContent = all.filter(b=>b.status==="pending").length;
      document.getElementById("statConfirmed").textContent = all.filter(b=>b.status==="confirmed").length;
      document.getElementById("statRejected").textContent = all.filter(b=>b.status==="rejected").length;

      document.getElementById("countPending").textContent = document.getElementById("statPending").textContent;
      document.getElementById("countConfirmed").textContent = document.getElementById("statConfirmed").textContent;
      document.getElementById("countRejected").textContent = document.getElementById("statRejected").textContent;

      const filtered = all.filter(b => b.status === currentTab);
      list.innerHTML = "";

      if (filtered.length === 0) {
        list.innerHTML = `<li class="empty-state"><div class="empty-icon">🪑</div><p>No ${currentTab} bookings.</p></li>`;
        return;
      }

      filtered.forEach(b => {
        let actionsHTML = "";
        if (b.status === "pending") {
          actionsHTML = `
            <button class="btn btn-sm btn-success" onclick="action('/confirm/${b.id}')">✅ Confirm</button>
            <button class="btn btn-sm btn-danger" onclick="action('/reject/${b.id}')">❌ Reject</button>
          `;
        } else if (b.status === "confirmed") {
          actionsHTML = ``; // PDF download moved to patient confirmation page
        }

        list.innerHTML += `
          <li class="booking-card">
            <div class="booking-header">
              <div class="token-badge">#${b.token}</div>
              <div class="booking-primary">
                <div class="booking-name">${b.name} <span class="booking-meta">· Age ${b.age} · 📞 ${b.phone}</span></div>
                <div class="booking-meta">🩺 ${b.doctor.name} (${b.doctor.specialization})</div>
              </div>
              <div class="status-badge ${b.status}">${b.status}</div>
            </div>
            <div class="booking-details">
              <span><b>Date:</b> ${b.date}</span>
              <span><b>Slot:</b> ${b.timeSlot}</span>
              <span><b>Problem:</b> ${b.problem}</span>
              <span><b>Booked At:</b> ${b.bookedAt}</span>
            </div>
            <div class="booking-actions">${actionsHTML}</div>
          </li>
        `;
      });
    } catch (e) {
      showToast("Failed to load bookings", "error");
    }
  }

  document.getElementById("callNextBtn").addEventListener("click", () => action("/next", "DELETE"));
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("Reset ALL bookings? This cannot be undone.")) action("/reset");
  });

  loadBookings();
  setInterval(loadBookings, 5000);
}

// ==========================================
// CONFIRMATION PAGE LOGIC
// ==========================================
const confCard = document.getElementById("confirmationCard");
if (confCard) {
  const loadBooking = async () => {
    const id = localStorage.getItem("bookingId");
    if (!id) {
      document.getElementById("loadingState").style.display = "none";
      document.getElementById("errorState").style.display = "block";
      return;
    }
    try {
      const res = await fetch(`/booking/${id}`);
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
        pdfBtn.href = `/pdf/${b.id}`;
      } else {
        pdfBtn.style.display = "none";
      }
      
      if (b.status === "cancelled" || b.status === "rejected") {
        cancelBtn.style.display = "none";
      } else {
        cancelBtn.style.display = "inline-flex";
        cancelBtn.onclick = async () => {
          if(!confirm("Are you sure you want to cancel this booking?")) return;
          try {
            const cancelRes = await fetch(`/cancel/${b.id}`, { method: "POST" });
            const cancelData = await cancelRes.json();
            if (!cancelRes.ok) throw new Error(cancelData.error);
            showToast("Booking cancelled successfully", "success");
            loadBooking(); // Reload
          } catch(e) {
            showToast(e.message, "error");
          }
        };
      }
    } catch(e) {
      document.getElementById("loadingState").style.display = "none";
      document.getElementById("errorState").style.display = "block";
    }
  };
  
  loadBooking();
}

