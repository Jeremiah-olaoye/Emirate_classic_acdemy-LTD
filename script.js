/* ================================================================
   EduTrack Pro — script.js
   Full frontend logic wired to Supabase backend.
   Requires: supabase.js loaded first.
   ================================================================ */

   'use strict';

   /* ── App state ───────────────────────────────────────────────── */
   const App = {
     currentSession: '2024/2025',
     currentTerm:    '3rd Term',
     currentUser:    null,
     students:       [],            /* cached student rows */
     chartsDrawn:    false,
     analyticsDrawn: false,
   };
   
   /* ================================================================
      BOOT — runs on every page load
      ================================================================ */
   document.addEventListener('DOMContentLoaded', async () => {
     /* 1. Guard — redirect to login if no session */
     const session = await EduAuth.requireAuth();
     if (!session) return;          /* requireAuth already redirected */
   
     /* 2. Load current user profile into UI */
     await loadUserProfile();
   
     /* 3. Init UI subsystems */
     safeCreateIcons();
     initNavigation();
     initSidebar();
     initTopbar();
     initTheme();
     initModal();
     initSettings();
     initReportCard();
   
     /* 4. Load dashboard data from Supabase */
     await Promise.all([
       loadDashboardStats(),
       loadResultsTable(),
     ]);
   
     /* 5. Draw charts */
     initCharts();
     animateCounters();
   });
   
   /* ── Lucide safe wrapper ─────────────────────────────────────── */
   function safeCreateIcons() {
     if (typeof lucide !== 'undefined') {
       try { lucide.createIcons(); } catch(e) {}
     }
   }
   
   /* ================================================================
      USER PROFILE
      ================================================================ */
   async function loadUserProfile() {
     try {
       const user = await EduAuth.getCurrentUser();
       if (!user) return;
       App.currentUser = user;
   
       const name  = user.profile?.name  || user.email?.split('@')[0] || 'Admin';
       const role  = user.profile?.role  || 'Administrator';
       const school= user.profile?.school_name || 'Government High School';
   
       /* Sidebar footer */
       const nameEl   = document.querySelector('.user-name-sm');
       const roleEl   = document.querySelector('.user-role-sm');
       const schoolEl = document.querySelector('.school-name');
       if (nameEl)   nameEl.textContent   = name;
       if (roleEl)   roleEl.textContent   = role;
       if (schoolEl) schoolEl.textContent = school;
   
       /* Topbar */
       const adminNameEl = document.querySelector('.admin-name');
       if (adminNameEl) adminNameEl.textContent = name.split(' ')[0];
   
       /* Welcome message */
       const welcomeEl = document.querySelector('.page-title');
       if (welcomeEl && welcomeEl.textContent.includes('Good morning')) {
         const hour = new Date().getHours();
         const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
         welcomeEl.textContent = `${greeting}, ${name.split(' ')[0]} 👋`;
       }
     } catch (err) {
       console.warn('Could not load user profile:', err);
     }
   }
   
   /* ================================================================
      NAVIGATION
      ================================================================ */
   function initNavigation() {
     document.querySelectorAll('.nav-item[data-page]').forEach(item => {
       item.addEventListener('click', (e) => {
         e.preventDefault();
         navigateTo(item.getAttribute('data-page'), item);
       });
     });
   
     /* data-page-link buttons (e.g. "View All") */
     document.querySelectorAll('[data-page-link]').forEach(btn => {
       btn.addEventListener('click', (e) => {
         e.preventDefault();
         const pageId = btn.getAttribute('data-page-link');
         navigateTo(pageId, document.querySelector(`.nav-item[data-page="${pageId}"]`));
       });
     });
   
     /* Logout buttons */
     document.querySelectorAll('[data-action="logout"]').forEach(btn => {
       btn.addEventListener('click', (e) => {
         e.preventDefault();
         EduAuth.signOut();
       });
     });
   }
   
   function navigateTo(pageId, navEl) {
     document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
     const target = document.getElementById('page-' + pageId);
     if (target) target.classList.add('active');
   
     document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
     if (navEl) navEl.classList.add('active');
   
     const labels = {
       dashboard:'Dashboard', students:'Students', results:'Results',
       subjects:'Subjects',   teachers:'Teachers', attendance:'Attendance',
       analytics:'Analytics', report:'Report Card', messages:'Messages', settings:'Settings',
     };
     const bc = document.getElementById('bcCurrent');
     if (bc) bc.textContent = labels[pageId] || pageId;
   
     closeMobileSidebar();
     if (pageId === 'analytics') setTimeout(initAnalyticsCharts, 80);
     const pw = document.querySelector('.page-wrapper');
     if (pw) pw.scrollTop = 0;
   
     safeCreateIcons();
   }
   
   /* ================================================================
      SIDEBAR
      ================================================================ */
   function initSidebar() {
     const btn     = document.getElementById('hamburgerBtn');
     const sidebar = document.getElementById('sidebar');
     const overlay = document.getElementById('sidebarOverlay');
     btn?.addEventListener('click', () => {
       const open = sidebar.classList.toggle('mobile-open');
       overlay.classList.toggle('active', open);
     });
     overlay?.addEventListener('click', closeMobileSidebar);
   }
   
   function closeMobileSidebar() {
     document.getElementById('sidebar')?.classList.remove('mobile-open');
     document.getElementById('sidebarOverlay')?.classList.remove('active');
   }
   
   /* ================================================================
      TOPBAR
      ================================================================ */
   function initTopbar() {
     const profileBtn = document.getElementById('adminProfileBtn');
     profileBtn?.addEventListener('click', (e) => {
       e.stopPropagation();
       profileBtn.classList.toggle('open');
     });
     document.addEventListener('click', () => profileBtn?.classList.remove('open'));
   }
   
   /* ================================================================
      THEME
      ================================================================ */
   function initTheme() {
     applyTheme(localStorage.getItem('edutrack-theme') || 'light');
     document.getElementById('themeToggle')?.addEventListener('click', () => {
       applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
     });
   }
   
   function applyTheme(theme) {
     document.documentElement.setAttribute('data-theme', theme);
     localStorage.setItem('edutrack-theme', theme);
     const moon = document.querySelector('.icon-moon');
     const sun  = document.querySelector('.icon-sun');
     if (moon) moon.style.display = theme === 'dark'  ? 'none' : '';
     if (sun)  sun.style.display  = theme === 'light' ? 'none' : '';
     setTimeout(updateChartsTheme, 50);
   }
   
   function setTheme(theme, el) {
     document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
     el?.classList.add('active');
     applyTheme(theme);
   }
   
   /* ================================================================
      DASHBOARD STATS — load from Supabase
      ================================================================ */
   async function loadDashboardStats() {
     try {
       const stats = await EduStats.loadAll(App.currentSession, App.currentTerm);
   
       /* Update stat card values */
       setStatValue('stat-students',   stats.studentCount);
       setStatValue('stat-results',    stats.resultCount);
       setStatValue('stat-avg',        stats.avgScore + '%');
       setStatValue('stat-passed',     stats.passed);
       setStatValue('stat-failed',     stats.failed);
       setStatValue('stat-attendance', stats.attRate + '%');
   
     } catch (err) {
       console.warn('Stats load error:', err);
     }
   }
   
   function setStatValue(dataId, value) {
     const el = document.querySelector(`[data-stat="${dataId}"]`);
     if (el) el.textContent = value;
   }
   
   function animateCounters() {
     document.querySelectorAll('.stat-value[data-count]').forEach(el => {
       const target = parseInt(el.dataset.count);
       const suffix = el.textContent.replace(/[\d,]/g, '');
       let current  = 0;
       const step   = Math.ceil(target / 50);
       const timer  = setInterval(() => {
         current = Math.min(current + step, target);
         el.textContent = current.toLocaleString() + suffix;
         if (current >= target) clearInterval(timer);
       }, 28);
     });
   }
   
   /* ================================================================
      RESULTS TABLE — load from Supabase
      ================================================================ */
   async function loadResultsTable() {
     const tbodies = ['resultsTableBody', 'fullResultsBody'];
     tbodies.forEach(id => EduUtils.showTableSkeleton(id, 8));
   
     try {
       /* Load students */
       const { data: students, error: stuErr } = await EduStudents.getAll();
       if (stuErr) throw new Error(stuErr);
   
       /* Load results for current term */
       const { data: results, error: resErr } = await EduResults.getAll({
         session: App.currentSession,
         term:    App.currentTerm,
       });
       if (resErr) throw new Error(resErr);
   
       /* Cache students */
       App.students = students;
   
       if (!students.length) {
         tbodies.forEach(id => EduUtils.showTableEmpty(id, 'No students found. Add students to get started.'));
         return;
       }
   
       /* Map to display rows */
       const mapped = students.map(s => EduUtils.mapStudentRow(s, results));
       const rows   = mapped.map((s, i) => buildRow(s, i)).join('');
   
       tbodies.forEach(id => {
         const el = document.getElementById(id);
         if (el) el.innerHTML = rows;
       });
   
       /* Attach action listeners */
       attachTableActions(mapped);
       updateNavCounts(students.length, results.length);
       safeCreateIcons();
   
     } catch (err) {
       tbodies.forEach(id => EduUtils.showTableError(id, 'Failed to load data: ' + err.message));
       showToast('Error loading data: ' + err.message, true);
     }
   }
   
   function updateNavCounts(studentCount, resultCount) {
     const stuCount = document.querySelector('[data-page="students"] .nav-count');
     const resCount = document.querySelector('[data-page="results"]  .nav-count');
     if (stuCount) stuCount.textContent = studentCount.toLocaleString();
     if (resCount) resCount.textContent = resultCount.toLocaleString();
   }
   
   /* ── Table row builder ─────────────────────────────────────── */
   const AVATAR_COLORS = ['#3B82F6','#7C3AED','#22C55E','#F59E0B','#EF4444','#60A5FA','#EC4899','#14B8A6'];
   
   function gradeClass(grade) {
     return { A:'grade-a', B:'grade-b', C:'grade-c', D:'grade-c', F:'grade-f' }[grade] || 'grade-c';
   }
   
   function buildRow(s, idx) {
     const initials = s.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
     const color    = AVATAR_COLORS[idx % AVATAR_COLORS.length];
     return `
       <tr data-student-id="${s.id || idx}">
         <td>
           <div class="student-cell">
             <div style="background:${color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#fff;flex-shrink:0;">${initials}</div>
             <div>
               <div class="student-name">${s.name}</div>
               <div class="student-id">${s.admNo || s.id || ''}</div>
             </div>
           </div>
         </td>
         <td>${s.class}</td>
         <td>${s.subjects}</td>
         <td>${s.total}</td>
         <td>${s.avg.toFixed(1)}%</td>
         <td><span class="grade-badge ${gradeClass(s.grade)}">${s.grade}</span></td>
         <td>
           <span class="status-badge status-${s.status}">
             <span class="status-dot"></span>${s.status === 'pass' ? 'Passed' : 'Failed'}
           </span>
         </td>
         <td>
           <div class="action-btns">
             <button class="action-btn view" data-idx="${idx}" title="View"><i data-lucide="eye"></i></button>
             <button class="action-btn edit" data-idx="${idx}" title="Edit"><i data-lucide="edit-3"></i></button>
             <button class="action-btn del"  data-idx="${idx}" title="Delete"><i data-lucide="trash-2"></i></button>
           </div>
         </td>
       </tr>`;
   }
   
   function attachTableActions(mapped) {
     document.querySelectorAll('.action-btn.view').forEach(btn => {
       btn.addEventListener('click', () => openModal(parseInt(btn.dataset.idx), mapped, 'view'));
     });
     document.querySelectorAll('.action-btn.edit').forEach(btn => {
       btn.addEventListener('click', () => openModal(parseInt(btn.dataset.idx), mapped, 'edit'));
     });
     document.querySelectorAll('.action-btn.del').forEach(btn => {
       btn.addEventListener('click', () => confirmDelete(btn, mapped[parseInt(btn.dataset.idx)]));
     });
   }
   
   /* ── Delete with Supabase ─────────────────────────────────── */
   async function confirmDelete(btn, student) {
     if (!student?.id) { deleteRowUI(btn); return; }
     if (!confirm(`Delete all results for ${student.name}? This cannot be undone.`)) return;
   
     const row = btn.closest('tr');
     row.style.opacity = '0.4';
   
     const { error } = await EduStudents.delete(student.id);
     if (error) {
       row.style.opacity = '';
       showToast('Delete failed: ' + error, true);
     } else {
       deleteRowUI(btn);
       showToast(`${student.name} deleted successfully.`);
       loadDashboardStats();
     }
   }
   
   function deleteRowUI(btn) {
     const row = btn.closest('tr');
     row.style.transition = 'opacity .3s, transform .3s';
     row.style.opacity    = '0';
     row.style.transform  = 'translateX(20px)';
     setTimeout(() => row.remove(), 300);
   }
   
   /* ================================================================
      MODAL — View / Edit result
      ================================================================ */
   let _modalStudents = [];
   
   function initModal() {
     document.getElementById('modalClose')?.addEventListener('click',  closeModal);
     document.getElementById('modalCancel')?.addEventListener('click', closeModal);
     document.getElementById('modalSave')?.addEventListener('click',   saveModalResult);
     document.getElementById('modalBackdrop')?.addEventListener('click', (e) => {
       if (e.target === document.getElementById('modalBackdrop')) closeModal();
     });
   }
   
   function openModal(idx, students, mode = 'edit') {
     _modalStudents = students || App.students;
     const s = _modalStudents[idx];
     if (!s) return;
   
     document.getElementById('modalStudentName').value = s.name;
     document.getElementById('modalClass').value       = s.class;
     document.getElementById('modalTotal').value       = s.total;
     document.getElementById('modalAvg').value         = s.avg;
     document.getElementById('modalGrade').value       = s.grade;
     document.getElementById('modalRemark').value      = s.remark || '';
   
     /* Store student id for saving */
     document.getElementById('resultModal').dataset.studentId = s.id || '';
     document.getElementById('resultModal').dataset.idx       = idx;
   
     const title = document.querySelector('.modal-title');
     if (title) title.textContent = mode === 'view' ? 'View Result' : 'Edit Result';
   
     const saveBtn = document.getElementById('modalSave');
     if (saveBtn) saveBtn.style.display = mode === 'view' ? 'none' : '';
   
     document.getElementById('modalBackdrop').classList.add('open');
   }
   
   async function saveModalResult() {
     const modal     = document.getElementById('resultModal');
     const studentId = modal.dataset.studentId;
     const idx       = parseInt(modal.dataset.idx);
   
     const name   = document.getElementById('modalStudentName').value;
     const cls    = document.getElementById('modalClass').value;
     const total  = parseFloat(document.getElementById('modalTotal').value) || 0;
     const avg    = parseFloat(document.getElementById('modalAvg').value)   || 0;
     const grade  = document.getElementById('modalGrade').value;
     const remark = document.getElementById('modalRemark').value;
   
     const saveBtn = document.getElementById('modalSave');
     saveBtn.textContent = 'Saving…';
     saveBtn.disabled    = true;
   
     try {
       if (studentId) {
         /* Update student class if changed */
         await EduStudents.update(studentId, { class: cls, name });
       }
   
       showToast('Result updated successfully!');
       closeModal();
   
       /* Refresh table row in place */
       const row = document.querySelector(`tr[data-student-id="${studentId || idx}"]`);
       if (row) {
         row.querySelector('.student-name').textContent = name;
         row.cells[1].textContent = cls;
         row.cells[3].textContent = total;
         row.cells[4].textContent = avg.toFixed(1) + '%';
         row.querySelector('.grade-badge').textContent  = grade;
         row.querySelector('.grade-badge').className    = `grade-badge ${gradeClass(grade)}`;
       }
     } catch (err) {
       showToast('Save failed: ' + err.message, true);
     } finally {
       saveBtn.innerHTML = '<i data-lucide="save"></i> Save Changes';
       saveBtn.disabled  = false;
       safeCreateIcons();
     }
   }
   
   function closeModal() {
     document.getElementById('modalBackdrop')?.classList.remove('open');
   }
   
   /* ================================================================
      REPORT CARD — form + Supabase save
      ================================================================ */
   const REPORT_SUBJECTS = [
     'Mathematics','English Language','Physics','Chemistry',
     'Biology','Economics','Civic Education','Agricultural Science',
   ];
   
   function initReportCard() {
     injectReportScores();
   
     /* Term tabs */
     document.querySelectorAll('.term-tab').forEach(tab => {
       tab.addEventListener('click', () => {
         document.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
         tab.classList.add('active');
         App.currentTerm = tab.textContent.trim();
       });
     });
   
     /* Logo upload */
     const area  = document.getElementById('logoUploadArea');
     const input = document.getElementById('logoUpload');
     area?.addEventListener('click', () => input?.click());
     input?.addEventListener('change', () => {
       if (input.files[0]) showToast('Logo uploaded! It will appear on the report card.');
     });
   
     /* Wire Download PDF button */
     const dlBtn = document.querySelector('#page-report .btn-primary');
     if (dlBtn) {
       dlBtn.addEventListener('click', async () => {
         await saveReportCard();
         printReportCard();
       });
     }
   
     /* Wire Print button */
     const printBtn = document.querySelector('#page-report .btn-outline');
     if (printBtn) printBtn.addEventListener('click', printReportCard);
   
     /* Student lookup — search when admission no. loses focus */
     const admInput = document.querySelector('input[placeholder="GHS/2024/001"]');
     if (admInput) {
       admInput.addEventListener('blur', async () => {
         const admNo = admInput.value.trim();
         if (!admNo) return;
         const { data: student } = await EduStudents.getByAdmission(admNo);
         if (student) {
           prefillStudentForm(student);
           await loadStudentResults(student.id);
           showToast(`Loaded: ${student.name}`);
         }
       });
     }
   }
   
   function prefillStudentForm(student) {
     const fields = document.querySelectorAll('#page-report .form-input');
     /* First Name / Last Name inputs */
     const nameParts = student.name.split(' ');
     const inputs    = document.querySelectorAll('#page-report .rcard input[type="text"]');
     if (inputs[0]) inputs[0].value = nameParts[0] || '';
     if (inputs[1]) inputs[1].value = nameParts.slice(1).join(' ') || '';
     /* Class select */
     const classEl = document.querySelector('#page-report select');
     if (classEl) classEl.value = student.class;
   }
   
   async function loadStudentResults(studentId) {
     const { data: results } = await EduResults.getForStudent(
       studentId, App.currentSession, App.currentTerm
     );
     if (!results || !results.length) return;
   
     /* Fill score inputs */
     results.forEach(r => {
       const idx = REPORT_SUBJECTS.findIndex(s => s.toLowerCase() === r.subject.toLowerCase());
       if (idx === -1) return;
       const caInput   = document.querySelector(`.ca-input[data-row="${idx}"]`);
       const examInput = document.querySelector(`.ex-input[data-row="${idx}"]`);
       if (caInput)   caInput.value   = r.ca_score   || 0;
       if (examInput) examInput.value = r.exam_score || 0;
     });
   
     recalcScores();
   }
   
   function injectReportScores() {
     const tbody = document.getElementById('scoresBody');
     if (!tbody) return;
     tbody.innerHTML = REPORT_SUBJECTS.map((subj, i) => `
       <tr>
         <td>${subj}</td>
         <td><input type="number" min="0" max="30" placeholder="0" class="ca-input" data-row="${i}" /></td>
         <td><input type="number" min="0" max="70" placeholder="0" class="ex-input" data-row="${i}" /></td>
         <td class="total-cell" id="rt-${i}">—</td>
         <td class="grade-cell" id="rg-${i}">—</td>
       </tr>`).join('');
   
     tbody.addEventListener('input', recalcScores);
   }
   
   function recalcScores() {
     const rows = document.querySelectorAll('#scoresBody tr');
     let grandTotal = 0, count = 0;
     rows.forEach((row, i) => {
       const ca  = parseFloat(row.querySelector('.ca-input')?.value)  || 0;
       const ex  = parseFloat(row.querySelector('.ex-input')?.value)  || 0;
       const tot = ca + ex;
       const grd = EduUtils.calcGrade(tot);
       const tc  = document.getElementById(`rt-${i}`);
       const gc  = document.getElementById(`rg-${i}`);
       if (tc) tc.textContent = (ca || ex) ? tot : '—';
       if (gc) gc.innerHTML   = (ca || ex) ? `<span class="grade-badge ${gradeClass(grd)}">${grd}</span>` : '—';
       if (ca || ex) { grandTotal += tot; count++; }
     });
     const avg = count ? (grandTotal / count).toFixed(1) : '0.0';
     const grd = count ? EduUtils.calcGrade(parseFloat(avg)) : '—';
     const ts  = document.getElementById('totalScore');
     const as  = document.getElementById('avgScore');
     const og  = document.getElementById('overallGrade');
     if (ts) ts.textContent = grandTotal || '—';
     if (as) as.textContent = count ? avg + '%' : '—';
     if (og) og.textContent = grd;
   }
   
   async function saveReportCard() {
     const admNo = document.querySelector('input[placeholder="GHS/2024/001"]')?.value?.trim();
     if (!admNo) { showToast('Enter student admission number first.', true); return; }
   
     /* Get student from Supabase */
     const { data: student, error: stuErr } = await EduStudents.getByAdmission(admNo);
     if (stuErr || !student) {
       showToast('Student not found in database. Add them first.', true);
       return;
     }
   
     /* Collect scores */
     const rows   = document.querySelectorAll('#scoresBody tr');
     const scores = [];
     rows.forEach((row, i) => {
       const ca   = parseFloat(row.querySelector('.ca-input')?.value) || 0;
       const exam = parseFloat(row.querySelector('.ex-input')?.value) || 0;
       if (ca > 0 || exam > 0) {
         scores.push({ subject: REPORT_SUBJECTS[i], ca, exam });
       }
     });
   
     if (!scores.length) { showToast('Enter at least one subject score.', true); return; }
   
     /* Save results */
     const { error: resErr } = await EduResults.saveForStudent(
       student.id, App.currentSession, App.currentTerm, scores
     );
     if (resErr) { showToast('Error saving results: ' + resErr, true); return; }
   
     /* Save report card summary */
     const avg   = parseFloat(document.getElementById('avgScore')?.textContent) || 0;
     const grade = document.getElementById('overallGrade')?.textContent || '—';
     const total = parseInt(document.getElementById('totalScore')?.textContent) || 0;
     const comments = document.querySelectorAll('#page-report textarea.form-input');
   
     const { error: rcErr } = await EduReportCards.save({
       studentId:        student.id,
       session:          App.currentSession,
       term:             App.currentTerm,
       totalScore:       total,
       average:          avg,
       overallGrade:     grade,
       teacherComment:   comments[0]?.value || '',
       principalComment: comments[1]?.value || '',
     });
   
     if (rcErr) { showToast('Error saving report card: ' + rcErr, true); return; }
   
     showToast(`Report card saved for ${student.name}!`);
   }
   
   function printReportCard() {
     /* Print only the preview panel */
     const preview = document.getElementById('reportPreview');
     if (!preview) { window.print(); return; }
   
     const printWin = window.open('', '_blank', 'width=800,height=600');
     printWin.document.write(`
       <!DOCTYPE html><html><head>
       <title>Report Card — EduTrack Pro</title>
       <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet" />
       <link rel="stylesheet" href="style.css" />
       <style>body{margin:20px;background:white;} .report-card-preview{box-shadow:none;border:1px solid #ccc;}</style>
       </head><body>
       ${preview.outerHTML}
       <script>window.onload=()=>{window.print();window.close();}<\/script>
       </body></html>`);
     printWin.document.close();
   }
   
   /* ================================================================
      SEARCH
      ================================================================ */
   document.addEventListener('DOMContentLoaded', () => {
     /* Live table search */
     document.getElementById('tableSearch')?.addEventListener('input', (e) => {
       const q = e.target.value.toLowerCase();
       document.querySelectorAll('#resultsTableBody tr').forEach(row => {
         const name = row.querySelector('.student-name')?.textContent.toLowerCase() || '';
         row.style.display = name.includes(q) ? '' : 'none';
       });
     });
   
     /* Class filter */
     document.getElementById('classFilter')?.addEventListener('change', async (e) => {
       const cls = e.target.value;
       document.querySelectorAll('#resultsTableBody tr, #fullResultsBody tr').forEach(row => {
         const rowClass = row.cells[1]?.textContent || '';
         row.style.display = (!cls || rowClass === cls) ? '' : 'none';
       });
     });
   });
   
   /* ================================================================
      SETTINGS — load from DB + save
      ================================================================ */
   function initSettings() {
     /* Tab switching */
     document.querySelectorAll('.set-tab').forEach(tab => {
       tab.addEventListener('click', () => {
         const target = tab.dataset.set;
         document.querySelectorAll('.set-tab').forEach(t => t.classList.remove('active'));
         tab.classList.add('active');
         document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
         document.getElementById('set-' + target)?.classList.add('active');
       });
     });
   
     /* Color swatches */
     document.querySelectorAll('.swatch').forEach(sw => {
       sw.addEventListener('click', () => {
         document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
         sw.classList.add('active');
         document.documentElement.style.setProperty('--primary', sw.dataset.color);
         showToast('Accent color updated!');
       });
     });
   
     /* Load saved settings */
     loadSettings();
   
     /* Save button */
     document.querySelector('#set-school .btn.btn-primary')?.addEventListener('click', saveSettings);
   }
   
   async function loadSettings() {
     const { data } = await EduSettings.load();
     if (!data) return;
   
     const inputs = document.querySelectorAll('#set-school .form-input');
     const map = [data.school_name, '', data.address, data.phone, data.email, data.session, data.term, String(data.max_ca)];
     inputs.forEach((input, i) => { if (map[i] !== undefined && map[i]) input.value = map[i]; });
   }
   
   async function saveSettings() {
     const inputs = document.querySelectorAll('#set-school .form-input');
     const vals   = Array.from(inputs).map(i => i.value);
   
     const { error } = await EduSettings.save({
       school_name: vals[0] || '',
       address:     vals[2] || '',
       phone:       vals[3] || '',
       email:       vals[4] || '',
       session:     vals[5] || App.currentSession,
       term:        vals[6] || App.currentTerm,
       max_ca:      parseInt(vals[7]) || 30,
     });
   
     if (error) { showToast('Save failed: ' + error, true); return; }
     showToast('Settings saved successfully!');
   }
   
   /* ================================================================
      MODAL — init
      ================================================================ */
   function initModal() {
     document.getElementById('modalClose')?.addEventListener('click',  closeModal);
     document.getElementById('modalCancel')?.addEventListener('click', closeModal);
     document.getElementById('modalSave')?.addEventListener('click',   saveModalResult);
     document.getElementById('modalBackdrop')?.addEventListener('click', (e) => {
       if (e.target === document.getElementById('modalBackdrop')) closeModal();
     });
   }
   
   /* ================================================================
      TOAST
      ================================================================ */
   function showToast(msg, isError = false) {
     const toast = document.getElementById('toast');
     const msgEl = document.getElementById('toastMsg');
     if (!toast || !msgEl) return;
     msgEl.textContent       = msg;
     toast.style.background  = isError ? '#991B1B' : '#1E293B';
     toast.classList.add('show');
     setTimeout(() => toast.classList.remove('show'), 3500);
   }
   
   /* ================================================================
      CHARTS
      ================================================================ */
   const isDark    = () => document.documentElement.getAttribute('data-theme') === 'dark';
   const textColor = () => isDark() ? '#8B949E' : '#94A3B8';
   const gridColor = () => isDark() ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
   
   const chartRegistry = {};
   function reg(id, inst) {
     if (chartRegistry[id]) { try { chartRegistry[id].destroy(); } catch(e){} }
     chartRegistry[id] = inst;
   }
   
   function initCharts() {
     if (App.chartsDrawn) return;
     App.chartsDrawn = true;
     drawSparklines();
     drawPerformanceChart();
     drawGradeDonut();
   }
   
   function drawSparklines() {
     const datasets = [
       [30,35,32,40,38,42,48,45,50,55,52,58],
       [80,95,110,100,120,115,130,125,135,140,138,145],
       [65,68,70,67,71,72,74,70,73,75,72,78],
       [300,320,310,340,335,350,365,360,375,385,380,398],
       [95,90,88,85,92,89,86,90,87,85,84,84],
       [88,90,87,91,89,92,91,93,90,91,92,91],
     ];
     const colors = ['#3B82F6','#7C3AED','#22C55E','#22C55E','#EF4444','#F59E0B'];
     for (let i = 1; i <= 6; i++) {
       const canvas = document.getElementById(`sparkline${i}`);
       if (!canvas) continue;
       const color = colors[i-1];
       reg(`sparkline${i}`, new Chart(canvas.getContext('2d'), {
         type: 'line',
         data: {
           labels: datasets[i-1].map(() => ''),
           datasets: [{ data: datasets[i-1], borderColor: color, borderWidth: 2, pointRadius: 0, fill: true,
             backgroundColor: ctx => {
               const g = ctx.chart.ctx.createLinearGradient(0,0,0,40);
               g.addColorStop(0, color+'44'); g.addColorStop(1, color+'00'); return g;
             }, tension: 0.4 }],
         },
         options: { responsive:false, animation:{duration:800},
           plugins:{legend:{display:false},tooltip:{enabled:false}},
           scales:{x:{display:false},y:{display:false}} },
       }));
     }
   }
   
   function drawPerformanceChart() {
     const canvas = document.getElementById('performanceChart');
     if (!canvas) return;
     reg('performance', new Chart(canvas.getContext('2d'), {
       type: 'bar',
       data: {
         labels: ['Mathematics','English','Physics','Chemistry','Biology','Economics','Agric','Civic'],
         datasets: [
           { label:'This Term', data:[68,74,62,59,71,78,65,73], backgroundColor:'#3B82F6CC', borderRadius:6, borderSkipped:false },
           { label:'Last Term', data:[62,70,58,55,68,74,61,70], backgroundColor:'#7C3AED66', borderRadius:6, borderSkipped:false },
         ],
       },
       options: {
         responsive:true,
         plugins: {
           legend:{position:'top',labels:{color:textColor(),font:{family:'Inter',size:11},padding:16,boxWidth:10}},
           tooltip:{backgroundColor:'#0F172A',titleColor:'#F1F5F9',bodyColor:'#94A3B8',padding:10,cornerRadius:8},
         },
         scales: {
           x:{grid:{display:false},ticks:{color:textColor(),font:{family:'Inter',size:11}},border:{color:gridColor()}},
           y:{grid:{color:gridColor()},ticks:{color:textColor(),font:{family:'Inter',size:11},callback:v=>v+'%'},border:{display:false},max:100,min:0},
         },
       },
     }));
   }
   
   function drawGradeDonut() {
     const canvas = document.getElementById('gradeChart');
     if (!canvas) return;
     reg('gradeDonut', new Chart(canvas.getContext('2d'), {
       type: 'doughnut',
       data: {
         labels:['A (80–100)','B (65–79)','C (50–64)','F (0–49)'],
         datasets:[{ data:[22,31,29,18], backgroundColor:['#3B82F6','#22C55E','#F59E0B','#EF4444'], borderWidth:0, hoverOffset:8 }],
       },
       options:{
         cutout:'70%', responsive:true,
         plugins:{legend:{display:false},tooltip:{backgroundColor:'#0F172A',titleColor:'#F1F5F9',bodyColor:'#94A3B8',padding:10,cornerRadius:8}},
       },
     }));
   }
   
   function initAnalyticsCharts() {
     if (App.analyticsDrawn) return;
     App.analyticsDrawn = true;
   
     const trendCanvas = document.getElementById('trendChart');
     if (trendCanvas) reg('trend', new Chart(trendCanvas.getContext('2d'), {
       type:'line',
       data:{
         labels:['Wk1','Wk2','Wk3','Wk4','Wk5','Wk6','Wk7','Wk8','Wk9','Wk10'],
         datasets:[
           {label:'1st Term',data:[62,64,63,65,67,66,68,70,69,72],borderColor:'#3B82F6',backgroundColor:'#3B82F618',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#3B82F6'},
           {label:'2nd Term',data:[68,70,72,71,74,73,76,75,78,80],borderColor:'#7C3AED',backgroundColor:'#7C3AED18',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#7C3AED'},
           {label:'3rd Term',data:[72,74,75,77,76,78,79,81,80,83],borderColor:'#22C55E',backgroundColor:'#22C55E18',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#22C55E'},
         ],
       },
       options:{
         responsive:true,
         plugins:{legend:{position:'top',labels:{color:textColor(),font:{family:'Inter',size:11},padding:16,boxWidth:10}},
                  tooltip:{mode:'index',intersect:false,backgroundColor:'#0F172A',titleColor:'#F1F5F9',bodyColor:'#94A3B8',padding:10,cornerRadius:8}},
         scales:{
           x:{grid:{color:gridColor()},ticks:{color:textColor(),font:{family:'Inter',size:11}},border:{display:false}},
           y:{grid:{color:gridColor()},ticks:{color:textColor(),font:{family:'Inter',size:11},callback:v=>v+'%'},border:{display:false},min:55,max:90},
         },
       },
     }));
   
     const subjCanvas = document.getElementById('subjectChart');
     if (subjCanvas) reg('subject', new Chart(subjCanvas.getContext('2d'), {
       type:'bar',
       data:{
         labels:['Math','English','Physics','Chemistry','Biology','Econ'],
         datasets:[{label:'Avg Score (%)',data:[68,74,62,59,71,78],
           backgroundColor:['#3B82F6','#22C55E','#F59E0B','#7C3AED','#EF4444','#60A5FA'].map(c=>c+'CC'),
           borderRadius:6,borderSkipped:false}],
       },
       options:{
         indexAxis:'y',responsive:true,
         plugins:{legend:{display:false},tooltip:{backgroundColor:'#0F172A',titleColor:'#F1F5F9',bodyColor:'#94A3B8',padding:10,cornerRadius:8}},
         scales:{
           x:{grid:{color:gridColor()},ticks:{color:textColor(),font:{family:'Inter',size:11},callback:v=>v+'%'},border:{display:false},max:100},
           y:{grid:{display:false},ticks:{color:textColor(),font:{family:'Inter',size:11}},border:{display:false}},
         },
       },
     }));
   
     const attCanvas = document.getElementById('attendanceChart');
     if (attCanvas) reg('attendance', new Chart(attCanvas.getContext('2d'), {
       type:'bar',
       data:{
         labels:['SS 1A','SS 1B','SS 2A','SS 2B','SS 3A','SS 3B','JSS 1','JSS 2','JSS 3'],
         datasets:[{label:'Attendance %',data:[93,88,95,82,91,79,94,87,85],
           backgroundColor:ctx=>{const v=ctx.raw;return v>=90?'#22C55ECC':v>=80?'#F59E0BCC':'#EF4444CC';},
           borderRadius:6,borderSkipped:false}],
       },
       options:{
         responsive:true,
         plugins:{legend:{display:false},tooltip:{backgroundColor:'#0F172A',titleColor:'#F1F5F9',bodyColor:'#94A3B8',padding:10,cornerRadius:8}},
         scales:{
           x:{grid:{display:false},ticks:{color:textColor(),font:{family:'Inter',size:10}},border:{display:false}},
           y:{grid:{color:gridColor()},ticks:{color:textColor(),font:{family:'Inter',size:11},callback:v=>v+'%'},border:{display:false},min:70,max:100},
         },
       },
     }));
   
     const gradeBarCanvas = document.getElementById('gradeBarChart');
     if (gradeBarCanvas) reg('gradebar', new Chart(gradeBarCanvas.getContext('2d'), {
       type:'bar',
       data:{
         labels:['A (80–100)','B (65–79)','C (50–64)','D (45–49)','F (0–44)'],
         datasets:[{label:'Students',data:[108,153,143,40,38],
           backgroundColor:['#22C55E','#3B82F6','#F59E0B','#7C3AED','#EF4444'].map(c=>c+'CC'),
           borderRadius:8,borderSkipped:false}],
       },
       options:{
         responsive:true,
         plugins:{legend:{display:false},tooltip:{backgroundColor:'#0F172A',titleColor:'#F1F5F9',bodyColor:'#94A3B8',padding:10,cornerRadius:8}},
         scales:{
           x:{grid:{display:false},ticks:{color:textColor(),font:{family:'Inter',size:11}},border:{display:false}},
           y:{grid:{color:gridColor()},ticks:{color:textColor(),font:{family:'Inter',size:11}},border:{display:false}},
         },
       },
     }));
   
     safeCreateIcons();
   }
   
   function updateChartsTheme() {
     Object.values(chartRegistry).forEach(c => { try { c.update(); } catch(e){} });
   }
   
   /* ================================================================
      KEYBOARD SHORTCUTS
      ================================================================ */
   document.addEventListener('keydown', (e) => {
     if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
       e.preventDefault();
       document.getElementById('globalSearch')?.focus();
     }
     if (e.key === 'Escape') {
       closeModal();
       document.getElementById('adminProfileBtn')?.classList.remove('open');
     }
   });