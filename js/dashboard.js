import { auth, db } from "./firebase.js";
import {
  collection, getDocs, doc, onSnapshot, updateDoc, setDoc,
  query, orderBy, limit, getDoc, addDoc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  onAuthStateChanged, signOut, sendPasswordResetEmail, deleteUser, updateProfile
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const ANN_SEEN = 'cb_ann_seen';
const STREAK_KEY = 'cb_streak';

function toast(msg, type='ok'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`show ${type}`;
  setTimeout(()=>t.className='',3200);
}

let userData=null, allCourses=[], currentUser=null;

// ─────────────────────────────────────────────────────────
// STREAK: update daily login streak
// ─────────────────────────────────────────────────────────
function updateStreak(){
  const now=new Date(); const today=now.toDateString();
  let streak=JSON.parse(localStorage.getItem(STREAK_KEY)||'{"count":0,"last":""}');
  const yesterday=new Date(now-86400000).toDateString();
  if(streak.last===today){ return streak.count; }
  else if(streak.last===yesterday){ streak.count++; }
  else if(streak.last!==today){ streak.count=1; }
  streak.last=today;
  localStorage.setItem(STREAK_KEY,JSON.stringify(streak));
  return streak.count;
}

// ─────────────────────────────────────────────────────────
// AUTH: real-time user data with OAuth email fix
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, user=>{
  if(!user){ window.location='login.html'; return; }
  currentUser=user;

  /* CRITICAL FIX: Ensure Firestore doc exists for OAuth users who may have
     signed in before their doc was created (race condition fix) */
  ensureUserDocExists(user);

  onSnapshot(doc(db,'users',user.uid), snap=>{
    if(!snap.exists()){
      /* Doc doesn't exist yet — create it now */
      ensureUserDocExists(user);
      return;
    }
    userData=snap.data();

    /* Patch email/name if missing (happens with OAuth users) */
    const patch={};
    if(!userData.email && user.email) patch.email=user.email;
    if(!userData.name && user.displayName) patch.name=user.displayName;
    if(!userData.purchasedCourses) patch.purchasedCourses=[];
    if(!userData.role) patch.role='user';
    if(Object.keys(patch).length>0){
      setDoc(doc(db,'users',user.uid),patch,{merge:true});
      return; /* onSnapshot will fire again with patched data */
    }

    const name     = userData.name  || user.displayName || user.email?.split('@')[0] || 'Student';
    const email    = userData.email || user.email || '';
    const phone    = userData.phone || '';
    const role     = userData.role  || 'user';
    const purchased      = userData.purchasedCourses || [];
    const courseProgress = userData.courseProgress   || {};

    /* Update streak */
    const streak = updateStreak();

    /* Stats */
    const completed = purchased.filter(cid=>courseProgress[cid]?.completed===true);
    let totalPct=0; purchased.forEach(cid=>{ totalPct+=Math.min(100,courseProgress[cid]?.pct||0); });
    const avgPct = purchased.length>0 ? Math.round(totalPct/purchased.length) : 0;

    /* Fill all elements */
    const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    s('welcomeName', name.split(' ')[0]);
    s('sbUserEmail', email);
    s('sbUserName',  name);
    s('statEnrolled',  purchased.length);
    s('statCompleted', completed.length);
    s('statAvgProg',   avgPct+'%');
    s('statStreak',    streak+'🔥');
    s('profileName',   name);
    s('profileEmail',  email);
    s('pStatCourses',  purchased.length);
    s('pStatCompleted',completed.length);
    s('profileRole',   role==='admin'?'🛡 Admin':'Student');
    if(phone) s('profilePhone','📞 '+phone);

    /* Avatar */
    const initial=(name[0]||'?').toUpperCase();
    ['profileAvatar','mobileAvatar'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=initial;});

    /* Edit fields */
    const setVal=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v;};
    setVal('editName',  name);
    setVal('editEmail', email);
    setVal('editPhone', phone);

    /* Session info */
    s('sessionInfo',    `Signed in as ${email}`);
    s('secSessionInfo', `${email} (${role})`);

    /* Render sections */
    renderCourses(allCourses, purchased, courseProgress);
    renderMyCourses(allCourses, purchased, courseProgress);
    renderProgress(allCourses, purchased, courseProgress, completed.length, avgPct);
    renderEarnedCerts(allCourses, purchased, courseProgress);
    loadCertificates(email);
    loadInvoices(email);
    checkUnreadAnnouncements(purchased);
    renderStreakCard(streak);
    loadQuickNotes();
    /* Extra progress tab elements */
    const ps=document.getElementById('pStreakDisp'); if(ps) ps.textContent=streak+' day'+(streak!==1?'s':'');
    const pc=document.getElementById('pCompDisp'); if(pc) pc.textContent=completed.length;
  });

  loadCourses();
});

/* Ensure Firestore document exists — fixes OAuth missing doc bug */
async function ensureUserDocExists(user){
  try{
    const ref=doc(db,'users',user.uid);
    const snap=await getDoc(ref);
    if(!snap.exists()){
      await setDoc(ref,{
        name: user.displayName||user.email?.split('@')[0]||'Student',
        email: user.email||'',
        phone: '',
        role: 'user',
        purchasedCourses: [],
        createdAt: serverTimestamp(),
        authProvider: user.providerData?.[0]?.providerId||'unknown'
      });
    }
  }catch(e){ console.warn('ensureUserDoc:',e); }
}

// ─────────────────────────────────────────────────────────
// STREAK CARD
// ─────────────────────────────────────────────────────────
function renderStreakCard(streak){
  const el=document.getElementById('streakCard');
  if(!el)return;
  const msgs=[
    '',
    'Day 1 — Keep it up! 🌱',
    'Day 2 — Good start! 💪',
    'Day 3 — 3 days strong! ⚡',
    'Day 4 — Building momentum! 🚀',
    'Day 5 — One week soon! 🎯',
    'Day 6 — Almost a week! 🌟',
    'Day 7 — One week streak! 🏆',
  ];
  const msg = streak>=7 ? `${streak} day streak! You're on fire! 🔥` : (msgs[streak]||`${streak} day streak! Keep going! 🔥`);
  el.innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:12px;background:rgba(245,158,11,.12);border:1.5px solid rgba(245,158,11,.28);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">🔥</div>
      <div>
        <p style="font-size:.82rem;font-weight:700;color:#fcd34d;">Daily Streak: ${streak} Day${streak!==1?'s':''}</p>
        <p style="font-size:.72rem;color:var(--dim);">${msg}</p>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────
// QUICK NOTES
// ─────────────────────────────────────────────────────────
function loadQuickNotes(){
  const ta=document.getElementById('quickNotesTA');
  if(!ta||!currentUser)return;
  const saved=localStorage.getItem(`cb_qnotes_${currentUser.uid}`)||'';
  ta.value=saved;
}
document.getElementById('saveQNotes')?.addEventListener('click',()=>{
  const ta=document.getElementById('quickNotesTA');
  if(!ta||!currentUser)return;
  localStorage.setItem(`cb_qnotes_${currentUser.uid}`,ta.value);
  toast('Notes saved ✅','ok');
});

// ─────────────────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────────────────
async function loadCourses(){
  const snap=await getDocs(collection(db,'courses'));
  allCourses=[];
  snap.forEach(c=>allCourses.push({id:c.id,...c.data()}));
  const purchased=userData?.purchasedCourses||[];
  const cp=userData?.courseProgress||{};
  renderCourses(allCourses,purchased,cp);
  renderMyCourses(allCourses,purchased,cp);
}

function courseCard(c, access, cp){
  const pct    = Math.min(100, cp?.[c.id]?.pct||0);
  const isDone = cp?.[c.id]?.completed===true;
  const lc     = c.lessons?.length||0;
  const thumb  = c.image||'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=400&q=70';
  return `
<div class="cc">
  <div style="overflow:hidden;"><img src="${thumb}" alt="${c.title}" loading="lazy"></div>
  <div style="padding:13px;flex:1;display:flex;flex-direction:column;">
    ${access?`<span style="font-size:.62rem;font-weight:700;color:${isDone?'#f59e0b':'#22c55e'};background:${isDone?'rgba(245,158,11,.1)':'rgba(34,197,94,.1)'};padding:2px 7px;border-radius:99px;border:1px solid ${isDone?'rgba(245,158,11,.2)':'rgba(34,197,94,.2)'};display:inline-flex;align-items:center;gap:4px;margin-bottom:7px;align-self:flex-start;">${isDone?'<i class="fas fa-check-circle"></i> Completed':'Enrolled'}</span>`:''}
    <h4 style="font-size:.86rem;font-weight:700;margin-bottom:4px;line-height:1.3;">${c.title}</h4>
    <p style="font-size:.72rem;color:var(--dim);margin-bottom:8px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:1;">${c.description||''}</p>
    ${lc?`<p style="font-size:.67rem;color:var(--dim);margin-bottom:8px;"><i class="fas fa-list" style="margin-right:3px;color:var(--c);"></i>${lc} lessons</p>`:''}
    ${access?`
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:.64rem;color:var(--dim);margin-bottom:4px;"><span>Progress</span><span style="color:${isDone?'#f59e0b':'var(--c)'};">${pct}%</span></div>
        <div class="prog-track"><div class="prog-fill${isDone?' prog-gold':''}" style="width:${pct}%;"></div></div>
      </div>
      ${isDone?`
        <div style="display:flex;gap:6px;">
          <a href="web-pentesting.html?id=${c.id}" style="flex:1;text-align:center;padding:8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:var(--dim);font-weight:600;font-size:.76rem;text-decoration:none;display:block;"><i class="fas fa-redo" style="margin-right:3px;"></i>Review</a>
          <a href="certificate.html?course=${c.id}" style="flex:1;text-align:center;padding:8px;border-radius:8px;background:linear-gradient(135deg,rgba(245,158,11,.2),rgba(251,191,36,.1));border:1px solid rgba(245,158,11,.3);color:#fcd34d;font-weight:700;font-size:.76rem;text-decoration:none;display:block;"><i class="fas fa-certificate" style="margin-right:3px;"></i>Certificate</a>
        </div>`
      :`<a href="web-pentesting.html?id=${c.id}" style="display:block;text-align:center;padding:8px;border-radius:8px;background:linear-gradient(135deg,#06b6d4,#0ea5e9);color:#042028;font-weight:700;font-size:.77rem;text-decoration:none;"><i class="fas fa-play" style="margin-right:4px;"></i>Continue Learning</a>`}
    `:`<button style="width:100%;padding:8px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:var(--dim);font-family:'Poppins',sans-serif;font-size:.77rem;font-weight:600;cursor:not-allowed;"><i class="fas fa-lock" style="margin-right:4px;"></i>Locked — Contact Admin</button>`}
  </div>
</div>`;
}

function renderCourses(courses, purchased, cp){
  const grid=document.getElementById('coursesGrid'); if(!grid)return;
  const q=document.getElementById('searchCourse')?.value?.toLowerCase()||'';
  const filtered=q?courses.filter(c=>c.title.toLowerCase().includes(q)||c.description?.toLowerCase().includes(q)):courses;
  if(!filtered.length){grid.innerHTML='<p style="color:var(--dim);font-size:.82rem;grid-column:1/-1;">No courses found.</p>';return;}
  grid.innerHTML=filtered.map(c=>courseCard(c,purchased.includes(c.id),cp)).join('');
}
function renderMyCourses(courses, purchased, cp){
  const grid=document.getElementById('myGrid'); if(!grid)return;
  const mine=courses.filter(c=>purchased.includes(c.id));
  if(!mine.length){grid.innerHTML='<p style="color:var(--dim);font-size:.82rem;grid-column:1/-1;">No enrolled courses yet. Contact admin for access.</p>';return;}
  grid.innerHTML=mine.map(c=>courseCard(c,true,cp)).join('');
}
document.getElementById('searchCourse')?.addEventListener('input',()=>renderCourses(allCourses,userData?.purchasedCourses||[],userData?.courseProgress||{}));

// ─────────────────────────────────────────────────────────
// PROGRESS TAB
// ─────────────────────────────────────────────────────────
function renderProgress(courses, purchased, cp, completedCount, avgPct){
  const mine=courses.filter(c=>purchased.includes(c.id));
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  s('progTotalEnrolled',mine.length);
  s('progTotalCompleted',completedCount);
  s('progOverallPct',avgPct+'%');
  const bar=document.getElementById('progOverallBar');
  if(bar){bar.style.width=avgPct+'%';if(avgPct>=100)bar.classList.add('prog-gold');}
  const el=document.getElementById('progCourseList'); if(!el)return;
  if(!mine.length){el.innerHTML='<p style="font-size:.78rem;color:var(--dim);">No enrolled courses yet.</p>';return;}
  el.innerHTML=mine.map(c=>{
    const pct=Math.min(100,cp[c.id]?.pct||0);
    const isDone=cp[c.id]?.completed===true;
    const done=cp[c.id]?.completedLessons?.length||0;
    const total=c.lessons?.length||cp[c.id]?.total||0;
    return `
<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.04);">
  ${c.image?`<img src="${c.image}" style="width:44px;height:32px;border-radius:5px;object-fit:cover;flex-shrink:0;">`:`<div style="width:44px;height:32px;border-radius:5px;background:rgba(6,182,212,.07);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="fas fa-book" style="color:#06b6d4;font-size:.7rem;"></i></div>`}
  <div style="flex:1;min-width:0;">
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
      <p style="font-size:.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${c.title}</p>
      <span style="font-size:.72rem;font-weight:700;color:${isDone?'#f59e0b':'var(--c)'};flex-shrink:0;margin-left:8px;">${pct}%${isDone?' ✓':''}</span>
    </div>
    <div class="prog-track"><div class="prog-fill${isDone?' prog-gold':''}" style="width:${pct}%;"></div></div>
    ${total?`<p style="font-size:.65rem;color:var(--dim);margin-top:3px;">${done}/${total} lessons</p>`:''}
  </div>
  <a href="web-pentesting.html?id=${c.id}" style="padding:5px 10px;border-radius:7px;background:rgba(6,182,212,.07);border:1px solid rgba(6,182,212,.14);color:#06b6d4;font-size:.7rem;font-weight:700;text-decoration:none;flex-shrink:0;white-space:nowrap;">
    <i class="fas fa-${isDone?'redo':'play'}" style="margin-right:2px;"></i>${isDone?'Review':'Continue'}
  </a>
</div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// EARNED CERTIFICATES (Firestore-authoritative)
// ─────────────────────────────────────────────────────────
function renderEarnedCerts(courses, purchased, cp){
  const el=document.getElementById('earnedCertList'); if(!el)return;
  const completed=purchased.filter(cid=>cp[cid]?.completed===true);
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  s('statCerts',completed.length);
  s('pStatCerts',completed.length);
  if(!completed.length){el.innerHTML='<p style="font-size:.78rem;color:var(--dim);">Complete a course to earn your certificate. Progress is saved securely.</p>';return;}
  const cm={};courses.forEach(c=>cm[c.id]=c);
  el.innerHTML=completed.map(cid=>{
    const c=cm[cid]||{}; const title=c.title||cid;
    const date=cp[cid]?.lastUpdated?new Date(cp[cid].lastUpdated).toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}):'Completed';
    return `
<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
  <div style="width:42px;height:42px;border-radius:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-trophy" style="color:#f59e0b;font-size:.9rem;"></i></div>
  <div style="flex:1;min-width:0;">
    <p style="font-weight:600;font-size:.85rem;">${title}</p>
    <p style="font-size:.72rem;color:var(--dim);margin-top:2px;"><i class="fas fa-calendar" style="margin-right:3px;color:var(--dim);font-size:.65rem;"></i>${date}</p>
  </div>
  <a href="certificate.html?course=${cid}" style="padding:7px 14px;border-radius:8px;background:linear-gradient(135deg,rgba(245,158,11,.18),rgba(251,191,36,.08));border:1px solid rgba(245,158,11,.28);color:#fcd34d;font-size:.73rem;font-weight:700;text-decoration:none;white-space:nowrap;display:flex;align-items:center;gap:4px;">
    <i class="fas fa-certificate"></i>View
  </a>
</div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────
// ISSUED CERTS from GitHub JSON
// ─────────────────────────────────────────────────────────
async function loadCertificates(email){
  const el=document.getElementById('certList'); if(!el)return;
  el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">Loading...</p>';
  try{
    const res=await fetch('https://raw.githubusercontent.com/Mubyyy404/Cyber-Buddy/main/certificates.json?t='+Date.now());
    if(!res.ok)throw new Error();
    const data=await res.json();
    const arr=Array.isArray(data)?data:(data.certificates||[]);
    const mine=arr.filter(c=>c.email?.toLowerCase()===email.toLowerCase());
    if(!mine.length){el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">No issued certificates found for your account.</p>';return;}
    el.innerHTML=mine.map(cert=>`
<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
  <div style="width:42px;height:42px;border-radius:10px;background:rgba(0,230,208,.08);border:1px solid rgba(0,230,208,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-certificate" style="color:#00e6d0;font-size:.9rem;"></i></div>
  <div style="flex:1;min-width:0;">
    <p style="font-weight:600;font-size:.85rem;">${cert.course||cert.title||'Certificate'}</p>
    <p style="font-size:.72rem;color:var(--dim);margin-top:2px;">${cert.type||'Completion'}${cert.issuedOn?' • '+cert.issuedOn:''}</p>
    ${cert.certId?`<p style="font-size:.65rem;font-family:monospace;color:var(--dim);margin-top:2px;">${cert.certId}</p>`:''}
  </div>
  ${(cert.download||cert.downloadUrl||cert.pdfUrl)?`<a href="${cert.download||cert.downloadUrl||cert.pdfUrl}" download target="_blank" style="padding:7px 14px;border-radius:8px;background:rgba(0,230,208,.08);border:1px solid rgba(0,230,208,.2);color:#00e6d0;font-size:.72rem;font-weight:700;text-decoration:none;white-space:nowrap;display:flex;align-items:center;gap:4px;"><i class="fas fa-download"></i>Download</a>`:''}
</div>`).join('');
  }catch(_){el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">Certificate data unavailable. Try again later.</p>';}
}

// ─────────────────────────────────────────────────────────
// BILLING
// ─────────────────────────────────────────────────────────
async function loadInvoices(email){
  const el=document.getElementById('invoiceList'); if(!el)return;
  el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">Loading...</p>';
  try{
    const res=await fetch('https://raw.githubusercontent.com/Mubyyy404/Cyber-Buddy/main/bills.json?t='+Date.now());
    if(!res.ok)throw new Error();
    const data=await res.json();
    const arr=Array.isArray(data)?data:(data.bills||[]);
    const mine=arr.filter(b=>b.email?.toLowerCase()===email.toLowerCase());
    if(!mine.length){el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">No billing records found for your account.</p>';return;}
    el.innerHTML=mine.map(b=>`
<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
  <div style="width:42px;height:42px;border-radius:10px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-receipt" style="color:#22c55e;font-size:.9rem;"></i></div>
  <div style="flex:1;min-width:0;">
    <p style="font-weight:600;font-size:.85rem;">${b.course}</p>
    <p style="font-size:.72rem;color:var(--dim);margin-top:2px;">₹${b.amount} • ${b.date}${b.paymentMode?' • '+b.paymentMode:''}</p>
  </div>
  ${b.verifyUrl?`<a href="${b.verifyUrl}" target="_blank" style="padding:7px 14px;border-radius:8px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);color:#22c55e;font-size:.72rem;font-weight:700;text-decoration:none;white-space:nowrap;"><i class="fas fa-check-circle" style="margin-right:3px;"></i>Verify</a>`:''}
</div>`).join('');
  }catch(_){el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">Billing data unavailable.</p>';}
}

// ─────────────────────────────────────────────────────────
// ANNOUNCEMENTS / NOTIFICATIONS
// ─────────────────────────────────────────────────────────
async function checkUnreadAnnouncements(purchased){
  try{
    const snap=await getDocs(query(collection(db,'announcements'),orderBy('createdAt','desc'),limit(20)));
    const seen=JSON.parse(localStorage.getItem(ANN_SEEN)||'[]');
    let unread=0;
    snap.forEach(d=>{
      const a=d.data();
      if(a.target==='enrolled'&&!purchased?.length)return;
      if(!seen.includes(d.id))unread++;
    });
    const dot=document.querySelector('.notif-dot');
    if(dot)dot.style.display=unread>0?'':'none';
  }catch(_){}
}

async function loadNotifications(purchased){
  const el=document.getElementById('notifList'); if(!el)return;
  el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">Loading...</p>';
  const typeMap={
    info:    {ico:'fas fa-info-circle',    col:'#06b6d4',bg:'rgba(6,182,212,.07)', bd:'rgba(6,182,212,.18)'},
    success: {ico:'fas fa-check-circle',   col:'#22c55e',bg:'rgba(34,197,94,.07)', bd:'rgba(34,197,94,.18)'},
    warning: {ico:'fas fa-exclamation-triangle',col:'#f59e0b',bg:'rgba(245,158,11,.07)',bd:'rgba(245,158,11,.18)'},
    alert:   {ico:'fas fa-exclamation-circle',  col:'#f87171',bg:'rgba(239,68,68,.07)', bd:'rgba(239,68,68,.18)'}
  };
  try{
    const snap=await getDocs(query(collection(db,'announcements'),orderBy('createdAt','desc'),limit(30)));
    const seen=JSON.parse(localStorage.getItem(ANN_SEEN)||'[]');
    const anns=[];
    snap.forEach(d=>{
      const a=d.data();
      if(a.target==='enrolled'&&!purchased?.length)return;
      anns.push({id:d.id,...a});
    });
    const dot=document.querySelector('.notif-dot');
    const unread=anns.filter(a=>!seen.includes(a.id)).length;
    if(dot)dot.style.display=unread>0?'':'none';
    if(!anns.length){
      el.innerHTML=`<div class="card"><div style="display:flex;gap:10px;align-items:flex-start;"><div style="width:36px;height:36px;border-radius:9px;background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas fa-bell" style="color:var(--c);font-size:.85rem;"></i></div><div><p style="font-size:.82rem;font-weight:600;margin-bottom:3px;">Welcome to Cyber Buddy Academy!</p><p style="font-size:.74rem;color:var(--dim);line-height:1.5;">Start your cybersecurity journey. Explore available courses and contact your admin to get enrolled.</p></div></div></div>`;
      return;
    }
    el.innerHTML=anns.map(a=>{
      const c=typeMap[a.type]||typeMap.info;
      const ts=a.createdAt?.toDate?.()?.toLocaleString()||'';
      const isNew=!seen.includes(a.id);
      return `<div style="background:${c.bg};border:1px solid ${c.bd};border-radius:10px;padding:14px 16px;position:relative;">${isNew?`<span style="position:absolute;top:10px;right:12px;font-size:.6rem;font-weight:700;background:${c.col};color:#000;padding:2px 7px;border-radius:99px;">NEW</span>`:''}<div style="display:flex;gap:10px;align-items:flex-start;"><i class="${c.ico}" style="color:${c.col};margin-top:2px;flex-shrink:0;font-size:1rem;"></i><div><p style="font-size:.84rem;font-weight:700;margin-bottom:4px;padding-right:44px;">${a.title||'Announcement'}</p><p style="font-size:.76rem;color:var(--dim);line-height:1.55;">${a.message||''}</p>${ts?`<p style="font-size:.65rem;color:var(--dim);margin-top:5px;">${ts}</p>`:''}</div></div></div>`;
    }).join('');
    localStorage.setItem(ANN_SEEN,JSON.stringify([...new Set([...seen,...anns.map(a=>a.id)])]));
    if(dot)dot.style.display='none';
  }catch(_){el.innerHTML='<p style="color:var(--dim);font-size:.78rem;">Could not load notifications.</p>';}
}
window._loadNotifs=()=>loadNotifications(userData?.purchasedCourses||[]);

// ─────────────────────────────────────────────────────────
// PROFILE UPDATE
// ─────────────────────────────────────────────────────────
document.getElementById('saveProfile')?.addEventListener('click',async()=>{
  const user=auth.currentUser; if(!user)return;
  const name =document.getElementById('editName')?.value.trim();
  const phone=document.getElementById('editPhone')?.value.trim();
  if(!name){toast('Name cannot be empty','err');return;}
  await updateDoc(doc(db,'users',user.uid),{name,phone});
  /* Also update Firebase Auth display name */
  try{await updateProfile(user,{displayName:name});}catch(_){}
  toast('Profile updated ✅','ok');
});

// ─────────────────────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────────────────────
async function sendReset(){
  const user=auth.currentUser; if(!user)return;
  await sendPasswordResetEmail(auth,user.email);
  toast('Reset email sent to '+user.email+' ✅','ok');
}
document.getElementById('resetPwBtn')?.addEventListener('click',sendReset);
document.getElementById('secResetBtn')?.addEventListener('click',sendReset);

// ─────────────────────────────────────────────────────────
// DELETE ACCOUNT
// ─────────────────────────────────────────────────────────
document.getElementById('deleteAccBtn')?.addEventListener('click',async()=>{
  if(!confirm('Permanently delete your account? This cannot be undone.'))return;
  try{await deleteUser(auth.currentUser);window.location='login.html';}
  catch(_){toast('Please sign out, sign back in, then try again','err');}
});

// ─────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click',async()=>{
  try{await signOut(auth);}catch(_){}
  window.location='login.html';
});
