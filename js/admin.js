import { auth, db } from "./firebase.js";

import {
  collection, getDocs, doc, getDoc, setDoc, addDoc,
  updateDoc, deleteDoc, arrayUnion, arrayRemove,
  query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3300);
}

// ─────────────────────────────────────────────────────────
// AUTH — role check from Firestore (IDOR prevention)
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) { window.location = 'login.html'; return; }

  const snap = await getDoc(doc(db, 'users', user.uid));

  if (!snap.exists() || snap.data().role !== 'admin') {
    alert('Unauthorized access. Redirecting...');
    window.location = 'dashboard.html';
    return;
  }

  // Show admin email badge
  const adminEmail = document.getElementById('adminEmail');
  const adminInitial = document.getElementById('adminInitial');
  if (adminEmail) adminEmail.textContent = user.email;
  if (adminInitial) adminInitial.textContent = (snap.data().name || user.email)[0].toUpperCase();

  loadDashboard();
  loadBuilderList();
});

// ─────────────────────────────────────────────────────────
// VIDEO URL CLEANER
// ─────────────────────────────────────────────────────────
function cleanUrl(input) {
  if (!input) return '';
  input = input.trim();
  const src = input.match(/src=["']([^"']+)["']/);
  if (src) input = src[1].trim();
  const drv = input.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (drv) return `https://drive.google.com/file/d/${drv[1]}/preview`;
  const yt = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  return input;
}

// ─────────────────────────────────────────────────────────
// LOAD DASHBOARD
// ─────────────────────────────────────────────────────────
async function loadDashboard() {
  const [usersSnap, coursesSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'courses'))
  ]);

  // Build course ID → title map
  const courseMap = {};
  const courseList = [];
  coursesSnap.forEach(c => {
    courseMap[c.id] = c.data().title || c.id;
    courseList.push({ id: c.id, ...c.data() });
  });

  // Enrollment stats
  let totalEnrollments = 0;
  let enrolledUsersCount = 0;
  const enrollmentCountByCourse = {};
  const recentUsers = [];
  const allUsersData = [];

  usersSnap.forEach(u => {
    const d = u.data();
    const owned = d.purchasedCourses || [];
    totalEnrollments += owned.length;
    if (owned.length > 0) enrolledUsersCount++;
    owned.forEach(cid => {
      enrollmentCountByCourse[cid] = (enrollmentCountByCourse[cid] || 0) + 1;
    });
    if (d.createdAt) recentUsers.push({ ...d, uid: u.id });
    allUsersData.push({ uid: u.id, ...d });
  });

  // Cache for export
  window._cachedUsers = allUsersData;
  window._courseMap = courseMap;

  // Update nav badges
  const nbUsers = document.getElementById('nb-users');
  const nbCourses = document.getElementById('nb-courses');
  if (nbUsers) nbUsers.textContent = usersSnap.size;
  if (nbCourses) nbCourses.textContent = coursesSnap.size;

  // Stat numbers
  document.getElementById('totalUsers').textContent = usersSnap.size;
  document.getElementById('totalCourses').textContent = coursesSnap.size;
  document.getElementById('totalEnrollments').textContent = totalEnrollments;
  document.getElementById('enrolledUsers').textContent = enrolledUsersCount;

  // Recent registrations
  const ru = document.getElementById('recentUsers');
  ru.innerHTML = '';
  const sorted = recentUsers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 6);
  if (!sorted.length) { ru.innerHTML = '<p style="font-size:.76rem;color:var(--dim);">No users yet.</p>'; }
  sorted.forEach(u => {
    ru.innerHTML += `
      <div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);">
        <div style="width:30px;height:30px;border-radius:50%;background:rgba(6,182,212,.15);border:1.5px solid rgba(6,182,212,.25);display:flex;align-items:center;justify-content:center;font-size:.76rem;font-weight:700;color:#06b6d4;flex-shrink:0;">${(u.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <p style="font-size:.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.name || 'Unknown'}</p>
          <p style="font-size:.67rem;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.email || ''}</p>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <span class="bdg ${u.role === 'admin' ? 'brd' : 'bcn'}">${u.role || 'user'}</span>
          <p style="font-size:.64rem;color:var(--dim);margin-top:2px;">${(u.purchasedCourses||[]).length} course${(u.purchasedCourses||[]).length!==1?'s':''}</p>
        </div>
      </div>`;
  });

  // Activity feed
  const af = document.getElementById('actFeed');
  af.innerHTML = '';
  try {
    const logSnap = await getDocs(query(collection(db, 'logs'), orderBy('time', 'desc'), limit(6)));
    if (logSnap.empty) {
      af.innerHTML = '<p style="font-size:.76rem;color:var(--dim);">No activity yet.</p>';
    } else {
      logSnap.forEach(l => {
        const d = l.data();
        const timeStr = d.time?.toDate?.()?.toLocaleString() || '';
        af.innerHTML += `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04);">
            <div style="width:7px;height:7px;border-radius:50%;background:#06b6d4;margin-top:5px;flex-shrink:0;"></div>
            <div>
              <p style="font-size:.76rem;">${d.message || ''}</p>
              <p style="font-size:.64rem;color:var(--dim);">${timeStr}</p>
            </div>
          </div>`;
      });
    }
  } catch (_) {
    af.innerHTML = '<p style="font-size:.76rem;color:var(--dim);">Enable Firestore logs collection to see activity.</p>';
  }

  // Course enrollment overview
  const ceo = document.getElementById('courseEnrollOverview');
  ceo.innerHTML = '';
  if (!courseList.length) {
    ceo.innerHTML = '<p style="font-size:.76rem;color:var(--dim);">No courses yet.</p>';
  } else {
    const sorted = [...courseList].sort((a,b)=>((enrollmentCountByCourse[b.id]||0)-(enrollmentCountByCourse[a.id]||0)));
    sorted.forEach(c => {
      const count = enrollmentCountByCourse[c.id] || 0;
      const pct = usersSnap.size > 0 ? Math.round(count / usersSnap.size * 100) : 0;
      ceo.innerHTML += `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);">
          <div style="flex:1;min-width:0;">
            <p style="font-size:.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.title}</p>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <div style="flex:1;height:4px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#06b6d4,#0ea5e9);border-radius:99px;transition:width .5s;"></div>
              </div>
              <span style="font-size:.68rem;color:var(--dim);flex-shrink:0;">${count} enrolled</span>
            </div>
          </div>
          <span class="bdg bcn" style="flex-shrink:0;">${(c.lessons||[]).length} lessons</span>
        </div>`;
    });
  }

  // Render tables
  renderUsers(usersSnap, courseList, courseMap);
  renderCourses(courseList);
}

// ─────────────────────────────────────────────────────────
// RENDER COURSES LIST
// ─────────────────────────────────────────────────────────
function renderCourses(courses) {
  const list = document.getElementById('coursesList');
  list.innerHTML = '';
  if (!courses.length) {
    list.innerHTML = '<p style="font-size:.8rem;color:var(--dim);">No courses yet.</p>';
    return;
  }
  courses.forEach(c => {
    const lessonCount = c.lessons?.length || 0;
    const vType = c.video?.includes('youtube') ? 'yt' : c.video?.includes('drive') ? 'drive' : '';
    const vBadge = vType === 'yt'
      ? '<span class="bdg byt"><i class="fab fa-youtube"></i> YouTube</span>'
      : vType === 'drive'
      ? '<span class="bdg bdv"><i class="fab fa-google-drive"></i> Drive</span>'
      : '';

    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg3);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:13px 15px;display:flex;align-items:center;gap:12px;transition:border-color .2s;';
    div.dataset.title = c.title.toLowerCase();
    div.onmouseenter = () => div.style.borderColor = 'rgba(6,182,212,.3)';
    div.onmouseleave = () => div.style.borderColor = 'rgba(255,255,255,.06)';
    div.innerHTML = `
      ${c.image
        ? `<img src="${c.image}" style="width:52px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0;">`
        : `<div style="width:52px;height:38px;border-radius:6px;background:rgba(6,182,212,.1);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fas fa-video" style="color:#06b6d4;font-size:.8rem;"></i></div>`}
      <div style="flex:1;min-width:0;">
        <p style="font-weight:600;font-size:.85rem;">${c.title}</p>
        <p style="font-size:.7rem;color:var(--dim);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.description || 'No description'}</p>
        <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
          ${vBadge}
          ${lessonCount ? `<span class="bdg bgr"><i class="fas fa-list"></i> ${lessonCount} lessons</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button onclick="window.open('web-pentesting.html?id=${c.id}','_blank')" class="btn bo bs"><i class="fas fa-eye"></i></button>
        <button onclick="window.deleteCourse('${c.id}')" class="btn br bs"><i class="fas fa-trash"></i></button>
      </div>`;
    list.appendChild(div);
  });
}

// ─────────────────────────────────────────────────────────
// RENDER USERS TABLE — with course NAMES shown
// ─────────────────────────────────────────────────────────
function renderUsers(usersSnap, courses, courseMap) {
  const tbody = document.getElementById('usersList');
  tbody.innerHTML = '';

  usersSnap.forEach(userDoc => {
    const d = userDoc.data();
    const owned = d.purchasedCourses || [];
    const joined = d.createdAt?.toDate?.()?.toLocaleDateString() || '—';
    const roleClass = d.role === 'admin' ? 'brd' : 'bcn';

    // Build course names list
    let courseDisplay = '<span style="font-size:.73rem;color:var(--dim);">None</span>';
    if (owned.length) {
      const names = owned.map(cid => courseMap[cid] || cid);
      courseDisplay = `
        <button onclick="window.showUserCourses('${userDoc.id}','${encodeURIComponent(d.name||d.email)}')"
          style="font-size:.73rem;color:#22c55e;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);padding:3px 8px;border-radius:6px;cursor:pointer;font-family:'Poppins',sans-serif;font-weight:600;">
          <i class="fas fa-book" style="margin-right:3px;"></i>${owned.length} course${owned.length!==1?'s':''}
          <i class="fas fa-external-link-alt" style="margin-left:3px;font-size:.6rem;"></i>
        </button>`;
    }

    const tr = document.createElement('tr');
    tr.dataset.search = `${d.name || ''} ${d.email || ''} ${d.role || ''}`.toLowerCase();
    tr.dataset.role = d.role || 'user';
    tr.dataset.enrolled = owned.length > 0 ? 'enrolled' : 'none';

    tr.innerHTML = `
      <td style="padding:9px 11px;font-weight:600;">${d.name || '—'}</td>
      <td style="padding:9px 11px;color:var(--dim);font-size:.76rem;">${d.email || '—'}</td>
      <td style="padding:9px 11px;"><span class="bdg ${roleClass}">${d.role || 'user'}</span></td>
      <td style="padding:9px 11px;font-size:.73rem;color:var(--dim);">${joined}</td>
      <td style="padding:9px 11px;">${courseDisplay}</td>
      <td style="padding:9px 11px;white-space:nowrap;">
        <select id="gs-${userDoc.id}" style="background:#1e293b;border:1px solid rgba(6,182,212,.2);color:#e2e8f0;font-family:'Poppins',sans-serif;font-size:.7rem;padding:4px 7px;border-radius:6px;outline:none;margin-right:4px;max-width:130px;">
          <option value="">Select course</option>
          ${courses.map(c => `<option value="${c.id}"${owned.includes(c.id)?' style="color:#22c55e;"':''}>${c.title}${owned.includes(c.id)?' ✓':''}</option>`).join('')}
        </select>
        <button onclick="window.grantCourse('${userDoc.id}',this)" class="btn bg bs" style="margin-right:3px;">Grant</button>
        <button onclick="window.revokeCourse('${userDoc.id}')" class="btn by bs">Revoke</button>
      </td>
      <td style="padding:9px 11px;white-space:nowrap;">
        <input id="name-${userDoc.id}" value="${d.name || ''}"
          style="background:#1e293b;border:1px solid rgba(6,182,212,.14);color:#e2e8f0;font-family:'Poppins',sans-serif;font-size:.73rem;padding:4px 7px;border-radius:6px;outline:none;width:110px;margin-right:4px;">
        <button onclick="window.updateUserName('${userDoc.id}')" class="btn bo bs">Save</button>
      </td>
      <td style="padding:9px 11px;white-space:nowrap;">
        <button onclick="window.deleteUserDoc('${userDoc.id}')" class="btn br bs"><i class="fas fa-trash"></i></button>
      </td>`;

    tbody.appendChild(tr);
  });

  initSearch();
}

// ─────────────────────────────────────────────────────────
// SHOW USER COURSE DETAIL MODAL
// ─────────────────────────────────────────────────────────
window.showUserCourses = async (uid, encodedName) => {
  const name = decodeURIComponent(encodedName);
  document.getElementById('ucModalTitle').textContent = `Courses — ${name}`;
  document.getElementById('ucModal').classList.add('open');

  const body = document.getElementById('ucModalBody');
  body.innerHTML = '<p style="color:var(--dim);font-size:.8rem;">Loading...</p>';

  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.data();
  const owned = data?.purchasedCourses || [];
  const courseMap = window._courseMap || {};

  if (!owned.length) {
    body.innerHTML = '<p style="color:var(--dim);font-size:.8rem;">This user has no enrolled courses.</p>';
    return;
  }

  // Fetch actual course docs for full details
  const courseDetails = await Promise.all(owned.map(async cid => {
    try {
      const cs = await getDoc(doc(db, 'courses', cid));
      if (cs.exists()) return { id: cid, ...cs.data() };
      return { id: cid, title: courseMap[cid] || cid, lessons: [] };
    } catch (_) { return { id: cid, title: courseMap[cid] || cid, lessons: [] }; }
  }));

  body.innerHTML = `
    <div style="margin-bottom:14px;padding:10px 12px;background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.15);border-radius:8px;font-size:.78rem;color:var(--dim);">
      <strong style="color:var(--tx);">${name}</strong> is enrolled in <strong style="color:#22c55e;">${owned.length}</strong> course${owned.length!==1?'s':''}
    </div>
    <div style="display:grid;gap:8px;">
      ${courseDetails.map(c => `
        <div style="background:var(--bg3);border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:12px 14px;display:flex;align-items:center;gap:12px;">
          ${c.image ? `<img src="${c.image}" style="width:48px;height:34px;object-fit:cover;border-radius:5px;flex-shrink:0;">` : `<div style="width:48px;height:34px;border-radius:5px;background:rgba(6,182,212,.08);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fas fa-book" style="color:#06b6d4;font-size:.7rem;"></i></div>`}
          <div style="flex:1;min-width:0;">
            <p style="font-weight:600;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.title}</p>
            <p style="font-size:.7rem;color:var(--dim);margin-top:2px;">${(c.lessons||[]).length} lessons${c.description ? ' • ' + c.description.substring(0,50) + (c.description.length>50?'...':'') : ''}</p>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;">
            <a href="web-pentesting.html?id=${c.id}" target="_blank" class="btn bo bs"><i class="fas fa-eye"></i></a>
          </div>
        </div>`).join('')}
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07);">
      <p style="font-size:.72rem;color:var(--dim);">To manage access, use the Grant/Revoke controls in the <button onclick="document.getElementById('ucModal').classList.remove('open');switchTab('users')" style="background:none;border:none;color:#06b6d4;font-weight:600;cursor:pointer;font-family:'Poppins',sans-serif;font-size:.72rem;">Users tab</button>.</p>
    </div>`;
};

// ─────────────────────────────────────────────────────────
// USER COURSES TAB
// ─────────────────────────────────────────────────────────
window._loadUserCourses = async () => loadUserCourses();

async function loadUserCourses() {
  const grid = document.getElementById('ucGrid');
  grid.innerHTML = '<p style="color:var(--dim);font-size:.8rem;">Loading...</p>';

  const [usersSnap, coursesSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'courses'))
  ]);

  const courseMap = {};
  coursesSnap.forEach(c => courseMap[c.id] = c.data().title || c.id);

  const users = [];
  usersSnap.forEach(u => users.push({ uid: u.id, ...u.data() }));

  window._ucAllUsers = users;
  window._ucCourseMap = courseMap;

  renderUCGrid(users, courseMap);

  // Search
  document.getElementById('ucSearch').oninput = function() { filterUCGrid(); };
  document.getElementById('ucEnrollFilter').onchange = function() { filterUCGrid(); };
}

function filterUCGrid() {
  const q = document.getElementById('ucSearch').value.toLowerCase();
  const f = document.getElementById('ucEnrollFilter').value;
  const users = window._ucAllUsers || [];
  const courseMap = window._ucCourseMap || {};
  const filtered = users.filter(u => {
    const matchQ = !q || `${u.name||''} ${u.email||''}`.toLowerCase().includes(q);
    const owned = u.purchasedCourses || [];
    const matchF = !f || (f === 'enrolled' ? owned.length > 0 : owned.length === 0);
    return matchQ && matchF;
  });
  renderUCGrid(filtered, courseMap);
}

function renderUCGrid(users, courseMap) {
  const grid = document.getElementById('ucGrid');
  if (!users.length) {
    grid.innerHTML = '<p style="color:var(--dim);font-size:.8rem;">No users found.</p>';
    return;
  }
  grid.innerHTML = users.map(u => {
    const owned = u.purchasedCourses || [];
    const courseNames = owned.map(cid => courseMap[cid] || cid);
    return `
      <div style="background:var(--bg3);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px;transition:border-color .2s;" onmouseenter="this.style.borderColor='rgba(6,182,212,.3)'" onmouseleave="this.style.borderColor='rgba(255,255,255,.06)'">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(6,182,212,.15);border:1.5px solid rgba(6,182,212,.25);display:flex;align-items:center;justify-content:center;font-size:.82rem;font-weight:700;color:#06b6d4;flex-shrink:0;">${(u.name||'?')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0;">
            <p style="font-weight:600;font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.name || 'Unknown'}</p>
            <p style="font-size:.68rem;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.email || ''}</p>
          </div>
          <span class="bdg ${u.role==='admin'?'brd':'bcn'}">${u.role||'user'}</span>
        </div>

        <div style="margin-bottom:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <p style="font-size:.68rem;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.8px;">Enrolled Courses</p>
            <span style="font-size:.7rem;color:${owned.length>0?'#22c55e':'var(--dim)'};">${owned.length} total</span>
          </div>
          ${owned.length === 0
            ? `<p style="font-size:.74rem;color:var(--dim);font-style:italic;">No courses assigned yet.</p>`
            : `<div style="display:flex;flex-wrap:wrap;gap:3px;">
                ${courseNames.map(name => `<span class="course-chip"><i class="fas fa-check-circle"></i>${name}</span>`).join('')}
              </div>`}
        </div>

        <button onclick="window.showUserCourses('${u.uid}','${encodeURIComponent(u.name||u.email)}')"
          style="width:100%;padding:7px;border-radius:7px;background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.15);color:#06b6d4;font-family:'Poppins',sans-serif;font-size:.74rem;font-weight:600;cursor:pointer;transition:all .2s;"
          onmouseover="this.style.background='rgba(6,182,212,.12)'" onmouseout="this.style.background='rgba(6,182,212,.06)'"
          ${owned.length===0?'disabled style="opacity:.4;cursor:not-allowed;"':''}>
          <i class="fas fa-external-link-alt" style="margin-right:4px;"></i>View Details
        </button>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// SEARCH + FILTER
// ─────────────────────────────────────────────────────────
function initSearch() {
  function applyFilters() {
    const q = document.getElementById('userSearch').value.toLowerCase();
    const role = document.getElementById('roleFilter').value;
    const enroll = document.getElementById('enrollFilter').value;
    document.querySelectorAll('#usersList tr').forEach(tr => {
      const matchQ = !q || tr.dataset.search?.includes(q);
      const matchR = !role || tr.dataset.role === role;
      const matchE = !enroll || tr.dataset.enrolled === enroll;
      tr.style.display = matchQ && matchR && matchE ? '' : 'none';
    });
  }
  document.getElementById('userSearch').addEventListener('input', applyFilters);
  document.getElementById('roleFilter').addEventListener('change', applyFilters);
  document.getElementById('enrollFilter').addEventListener('change', applyFilters);
}

// ─────────────────────────────────────────────────────────
// GRANT ACCESS
// ─────────────────────────────────────────────────────────
window.grantCourse = async (uid, btn) => {
  const courseId = document.getElementById(`gs-${uid}`).value;
  if (!courseId) { toast('Select a course to grant', 'err'); return; }

  // IDOR check: verify user exists before granting
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) { toast('User not found', 'err'); return; }

  const owned = snap.data().purchasedCourses || [];
  if (owned.includes(courseId)) { toast('User already has this course', 'err'); return; }

  btn.disabled = true; btn.textContent = '...';

  await updateDoc(doc(db, 'users', uid), { purchasedCourses: arrayUnion(courseId) });

  try {
    await addDoc(collection(db, 'logs'), {
      message: `Course "${courseId}" granted to ${snap.data().email || uid}`,
      time: serverTimestamp()
    });
  } catch (_) {}

  btn.textContent = '✓ Granted'; btn.style.color = '#22c55e';
  toast('Course access granted ✅', 'ok');
  setTimeout(() => { loadDashboard(); btn.textContent = 'Grant'; btn.style.color = ''; btn.disabled = false; }, 1800);
};

// ─────────────────────────────────────────────────────────
// REVOKE ACCESS
// ─────────────────────────────────────────────────────────
window.revokeCourse = async uid => {
  const courseId = document.getElementById(`gs-${uid}`).value;
  if (!courseId) { toast('Select a course to revoke', 'err'); return; }

  await updateDoc(doc(db, 'users', uid), { purchasedCourses: arrayRemove(courseId) });

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    await addDoc(collection(db, 'logs'), {
      message: `Course "${courseId}" revoked from ${snap.data().email || uid}`,
      time: serverTimestamp()
    });
  } catch (_) {}

  toast('Access revoked', 'info');
  loadDashboard();
};

// ─────────────────────────────────────────────────────────
// UPDATE USER NAME
// ─────────────────────────────────────────────────────────
window.updateUserName = async uid => {
  const name = document.getElementById(`name-${uid}`).value.trim();
  if (!name) { toast('Name cannot be empty', 'err'); return; }
  await updateDoc(doc(db, 'users', uid), { name });
  toast('Name updated ✅', 'ok');
};

// ─────────────────────────────────────────────────────────
// DELETE USER
// ─────────────────────────────────────────────────────────
window.deleteUserDoc = async uid => {
  if (!confirm('Delete this user record from Firestore? This only removes their data — the Auth account remains.')) return;
  await deleteDoc(doc(db, 'users', uid));
  toast('User data deleted', 'ok');
  loadDashboard();
};

// ─────────────────────────────────────────────────────────
// DELETE COURSE
// ─────────────────────────────────────────────────────────
window.deleteCourse = async id => {
  if (!confirm('Delete this course? This cannot be undone.')) return;
  await deleteDoc(doc(db, 'courses', id));
  toast('Course deleted', 'ok');
  loadDashboard();
  loadBuilderList();
};

// ─────────────────────────────────────────────────────────
// QUICK UPLOAD COURSE
// ─────────────────────────────────────────────────────────
document.getElementById('uploadBtn').onclick = async () => {
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const image = document.getElementById('image').value.trim();
  const videoRaw = document.getElementById('video').value.trim();
  if (!title) { toast('Course title is required', 'err'); return; }

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>Uploading...';

  try {
    await setDoc(doc(db, 'courses', title.toLowerCase().replace(/[^a-z0-9]+/g, '-')), {
      title, description, image,
      video: cleanUrl(videoRaw),
      lessons: [],
      createdAt: serverTimestamp()
    });
    toast('Course uploaded ✅', 'ok');
    ['title', 'description', 'image', 'video'].forEach(id => document.getElementById(id).value = '');
    loadDashboard();
    loadBuilderList();
  } catch (e) {
    toast('Upload failed: ' + e.message, 'err');
  }

  btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i>Upload Course';
};

// ─────────────────────────────────────────────────────────
// PASSWORD RESET (Security tab)
// ─────────────────────────────────────────────────────────
document.getElementById('resetPassword').onclick = async () => {
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) { toast('Enter an email address', 'err'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Password reset email sent to ' + email + ' ✅', 'ok');
    document.getElementById('resetEmail').value = '';
  } catch (e) {
    if (e.code === 'auth/user-not-found') toast('No account found with that email', 'err');
    else toast(e.message, 'err');
  }
};

// ─────────────────────────────────────────────────────────
// CHANGE USER ROLE
// ─────────────────────────────────────────────────────────
document.getElementById('changeRoleBtn').onclick = async () => {
  const email = document.getElementById('roleEmail').value.trim();
  const newRole = document.getElementById('roleVal').value;
  if (!email) { toast('Enter a user email', 'err'); return; }

  const usersSnap = await getDocs(collection(db, 'users'));
  let found = null;
  usersSnap.forEach(u => { if (u.data().email === email) found = u; });
  if (!found) { toast('No user found with that email', 'err'); return; }

  await updateDoc(doc(db, 'users', found.id), { role: newRole });
  try {
    await addDoc(collection(db, 'logs'), {
      message: `Role of ${email} changed to "${newRole}"`,
      time: serverTimestamp()
    });
  } catch (_) {}

  toast(`Role updated to "${newRole}" ✅`, 'ok');
  document.getElementById('roleEmail').value = '';
  loadDashboard();
};

// ─────────────────────────────────────────────────────────
// REVOKE ALL COURSES (Security tab)
// ─────────────────────────────────────────────────────────
document.getElementById('revokeAllBtn').onclick = async () => {
  const email = document.getElementById('revokeAllEmail').value.trim();
  if (!email) { toast('Enter a user email', 'err'); return; }
  if (!confirm(`Remove ALL course access from ${email}? This cannot be undone.`)) return;

  const usersSnap = await getDocs(collection(db, 'users'));
  let found = null;
  usersSnap.forEach(u => { if (u.data().email === email) found = u; });
  if (!found) { toast('No user found with that email', 'err'); return; }

  await updateDoc(doc(db, 'users', found.id), { purchasedCourses: [] });
  try {
    await addDoc(collection(db, 'logs'), {
      message: `All course access revoked from ${email}`,
      time: serverTimestamp()
    });
  } catch (_) {}

  toast('All course access revoked ✅', 'ok');
  document.getElementById('revokeAllEmail').value = '';
  loadDashboard();
};

// ─────────────────────────────────────────────────────────
// USER LOOKUP (Security tab)
// ─────────────────────────────────────────────────────────
document.getElementById('lookupBtn').onclick = async () => {
  const email = document.getElementById('lookupEmail').value.trim();
  const resultEl = document.getElementById('lookupResult');
  if (!email) { toast('Enter an email', 'err'); return; }

  resultEl.innerHTML = '<p style="font-size:.76rem;color:var(--dim);">Searching...</p>';

  const usersSnap = await getDocs(collection(db, 'users'));
  let found = null;
  usersSnap.forEach(u => { if (u.data().email === email) found = { uid: u.id, ...u.data() }; });

  if (!found) {
    resultEl.innerHTML = '<p style="font-size:.76rem;color:#f87171;"><i class="fas fa-times-circle" style="margin-right:4px;"></i>No user found with that email.</p>';
    return;
  }

  const courseMap = window._courseMap || {};
  const owned = found.purchasedCourses || [];
  const courseNames = owned.map(cid => courseMap[cid] || cid);

  resultEl.innerHTML = `
    <div style="background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.15);border-radius:8px;padding:12px;font-size:.78rem;">
      <div style="display:grid;gap:5px;">
        <div style="display:flex;gap:8px;"><span style="color:var(--dim);min-width:60px;">Name</span><strong>${found.name||'—'}</strong></div>
        <div style="display:flex;gap:8px;"><span style="color:var(--dim);min-width:60px;">Email</span><strong>${found.email}</strong></div>
        <div style="display:flex;gap:8px;"><span style="color:var(--dim);min-width:60px;">Role</span><span class="bdg ${found.role==='admin'?'brd':'bcn'}">${found.role||'user'}</span></div>
        <div style="display:flex;gap:8px;"><span style="color:var(--dim);min-width:60px;">Phone</span>${found.phone||'—'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;"><span style="color:var(--dim);min-width:60px;">Courses</span>
          ${owned.length ? courseNames.map(n=>`<span class="bdg bgr">${n}</span>`).join(' ') : '<span style="color:var(--dim);">None</span>'}
        </div>
        <div style="display:flex;gap:8px;"><span style="color:var(--dim);min-width:60px;">UID</span><code style="font-size:.68rem;color:var(--c);">${found.uid}</code></div>
      </div>
    </div>`;
};

// ─────────────────────────────────────────────────────────
// ACTIVITY LOGS TAB
// ─────────────────────────────────────────────────────────
async function loadLogs() {
  const container = document.getElementById('logsContainer');
  container.innerHTML = '<p style="color:var(--dim);font-size:.8rem;">Loading...</p>';
  try {
    const snap = await getDocs(query(collection(db, 'logs'), orderBy('time', 'desc'), limit(100)));
    if (snap.empty) { container.innerHTML = '<p style="color:var(--dim);font-size:.8rem;">No activity logs yet.</p>'; return; }
    container.innerHTML = '';
    snap.forEach(l => {
      const d = l.data();
      const timeStr = d.time?.toDate?.()?.toLocaleString() || '—';
      const isGrant = d.message?.includes('granted');
      const isRevoke = d.message?.includes('revoked');
      const isRole = d.message?.includes('Role');
      const dotColor = isGrant ? '#22c55e' : isRevoke ? '#f87171' : isRole ? '#a78bfa' : '#06b6d4';
      container.innerHTML += `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--bg3);border:1px solid rgba(255,255,255,.05);border-radius:8px;margin-bottom:6px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${dotColor};margin-top:5px;flex-shrink:0;"></div>
          <div style="flex:1;">
            <p style="font-size:.8rem;">${d.message || '—'}</p>
            <p style="font-size:.66rem;color:var(--dim);margin-top:2px;">${timeStr}</p>
          </div>
        </div>`;
    });
  } catch (e) {
    container.innerHTML = `<p style="color:#f87171;font-size:.8rem;">Error loading logs: ${e.message}</p>`;
  }
}
window._loadLogs = loadLogs;
window.loadUserCourses = loadUserCourses;

// ─────────────────────────────────────────────────────────
// LOGOUT — properly signs out Firebase auth
// ─────────────────────────────────────────────────────────
document.getElementById('logoutBtn').onclick = async () => {
  try {
    await signOut(auth);
    window.location = 'login.html';
  } catch (e) {
    toast('Logout failed: ' + e.message, 'err');
  }
};

// ═════════════════════════════════════════════════════════
// COURSE BUILDER
// ═════════════════════════════════════════════════════════

async function loadBuilderList() {
  const sel = document.getElementById('builderSel');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select —</option>';
  const snap = await getDocs(collection(db, 'courses'));
  snap.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.data().title || c.id;
    sel.appendChild(o);
  });
  if (prev) sel.value = prev;
}

document.getElementById('loadBuilderBtn').onclick = async () => {
  const id = document.getElementById('builderSel').value;
  if (!id) { toast('Select a course first', 'err'); return; }
  const snap = await getDoc(doc(db, 'courses', id));
  if (!snap.exists()) { toast('Course not found', 'err'); return; }
  populateBuilder(id, snap.data());
  toast('Course loaded ✅', 'ok');
};

function populateBuilder(id, d) {
  document.getElementById('bId').value = id;
  document.getElementById('bTitle').value = d.title || '';
  document.getElementById('bDesc').value = d.description || '';
  document.getElementById('bImage').value = d.image || '';
  document.getElementById('lessonsContainer').innerHTML =
    '<p style="font-size:.78rem;color:var(--dim);text-align:center;padding:12px;">No lessons yet. Add one above.</p>';
  lc = 0;
  if (d.lessons && d.lessons.length) {
    d.lessons.forEach(l => addLesson(l));
  } else if (d.video) {
    addLesson({ title: d.title, videoUrl: d.video, description: d.description || '' });
  }
  document.getElementById('builderForm').style.display = 'block';
}

document.getElementById('createBtn').onclick = async () => {
  const title = document.getElementById('newTitle').value.trim();
  const id = document.getElementById('newId').value.trim();
  if (!title || !id) { toast('Title and ID are both required', 'err'); return; }

  await setDoc(doc(db, 'courses', id), {
    title, description: '', image: '', lessons: [], createdAt: serverTimestamp()
  });

  await loadBuilderList();
  await loadDashboard();
  document.getElementById('builderSel').value = id;
  document.getElementById('newModal').classList.remove('open');
  populateBuilder(id, { title, description: '', image: '', lessons: [] });
  toast('Course created ✅', 'ok');
};

document.getElementById('saveCourseBtn').onclick = async () => {
  const id = document.getElementById('bId').value.trim();
  const title = document.getElementById('bTitle').value.trim();
  const desc = document.getElementById('bDesc').value.trim();
  const image = document.getElementById('bImage').value.trim();
  if (!id || !title) { toast('Course title is required', 'err'); return; }

  const lessons = getLessons();
  if (!lessons.length) { toast('Add at least one lesson with a title and video URL', 'err'); return; }

  const btn = document.getElementById('saveCourseBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>Saving...';

  try {
    await setDoc(doc(db, 'courses', id), {
      title, description: desc, image, lessons, updatedAt: serverTimestamp()
    }, { merge: true });
    toast('Course saved ✅', 'ok');
    loadDashboard(); loadBuilderList();
  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
  }

  btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i>Save to Firebase';
};

document.getElementById('previewBtn').onclick = () => {
  const id = document.getElementById('bId').value.trim();
  if (!id) { toast('Load a course first', 'err'); return; }
  window.open(`web-pentesting.html?id=${id}`, '_blank');
};

document.getElementById('deleteCourseBtn').onclick = async () => {
  const id = document.getElementById('bId').value.trim();
  const title = document.getElementById('bTitle').value.trim();
  if (!id) return;
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  await deleteDoc(doc(db, 'courses', id));
  document.getElementById('builderForm').style.display = 'none';
  document.getElementById('bId').value = '';
  await loadDashboard(); await loadBuilderList();
  toast('Course deleted', 'ok');
};
