/* ================================================================
   EduTrack Pro — supabase.js
   Complete Supabase backend layer:
   - Authentication (login, logout, reset, session guard)
   - Students CRUD
   - Results CRUD
   - Report Cards CRUD
   - Dashboard stats
   - Settings persistence

   HOW TO SET UP:
   1. Go to https://supabase.com and create a free project
   2. In SQL Editor, run the SQL in setup.sql (provided below as comments)
   3. Replace the two values below with yours from:
      Supabase Dashboard → Settings → API
   ================================================================ */

/* ================================================================
   !! REPLACE THESE TWO VALUES WITH YOUR OWN !!
   ================================================================ */
   const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
   const SUPABASE_KEY = 'YOUR_ANON_PUBLIC_KEY';
   /* ================================================================ */
   
   /* ── Initialise Supabase client ───────────────────────────────── */
   const { createClient } = supabase;
   const _db = createClient(SUPABASE_URL, SUPABASE_KEY, {
     auth: {
       autoRefreshToken: true,
       persistSession:   true,          /* keeps user logged in across page reloads */
       detectSessionInUrl: true,        /* handles email confirm/reset links */
     }
   });
   
   /* ================================================================
      AUTH MODULE
      ================================================================ */
   const EduAuth = {
   
     /* Sign in with email + password */
     async signIn(email, password) {
       const { data, error } = await _db.auth.signInWithPassword({ email, password });
       if (error) return { error: error.message };
       return { user: data.user, session: data.session };
     },
   
     /* Sign out */
     async signOut() {
       await _db.auth.signOut();
       window.location.href = 'login.html';
     },
   
     /* Send password reset email */
     async resetPassword(email) {
       const { error } = await _db.auth.resetPasswordForEmail(email, {
         redirectTo: window.location.origin + '/index.html',
       });
       if (error) return { error: error.message };
       return { success: true };
     },
   
     /* Get current session (returns null if not logged in) */
     async getSession() {
       const { data } = await _db.auth.getSession();
       return data.session;
     },
   
     /* Get current user profile (joined with admins table) */
     async getCurrentUser() {
       const { data: { user } } = await _db.auth.getUser();
       if (!user) return null;
   
       const { data: profile } = await _db
         .from('admins')
         .select('*')
         .eq('id', user.id)
         .single();
   
       return { ...user, profile };
     },
   
     /*
      * GUARD — call this at the top of index.html script.
      * Redirects to login.html if no active session.
      */
     async requireAuth() {
       const session = await this.getSession();
       if (!session) {
         window.location.href = 'login.html';
         return null;
       }
       return session;
     },
   };
   
   /* ================================================================
      STUDENTS MODULE
      ================================================================ */
   const EduStudents = {
   
     /* Get all students, optionally filtered */
     async getAll({ search = '', classFilter = '' } = {}) {
       let query = _db
         .from('students')
         .select('*')
         .order('name');
   
       if (search)      query = query.ilike('name', `%${search}%`);
       if (classFilter) query = query.eq('class', classFilter);
   
       const { data, error } = await query;
       return { data: data || [], error: error?.message };
     },
   
     /* Get one student by ID (with their results) */
     async getById(id) {
       const { data, error } = await _db
         .from('students')
         .select(`*, results(*)`)
         .eq('id', id)
         .single();
       return { data, error: error?.message };
     },
   
     /* Get one student by admission number */
     async getByAdmission(admissionNo) {
       const { data, error } = await _db
         .from('students')
         .select('*')
         .eq('admission_no', admissionNo)
         .single();
       return { data, error: error?.message };
     },
   
     /* Add a new student */
     async add({ name, admissionNo, studentClass, gender, dob }) {
       const { data, error } = await _db
         .from('students')
         .insert({
           name,
           admission_no:  admissionNo,
           class:         studentClass,
           gender,
           date_of_birth: dob || null,
         })
         .select()
         .single();
       return { data, error: error?.message };
     },
   
     /* Update a student */
     async update(id, fields) {
       const { data, error } = await _db
         .from('students')
         .update(fields)
         .eq('id', id)
         .select()
         .single();
       return { data, error: error?.message };
     },
   
     /* Delete a student (cascades to results + report_cards) */
     async delete(id) {
       const { error } = await _db.from('students').delete().eq('id', id);
       return { error: error?.message };
     },
   
     /* Count total students */
     async count() {
       const { count } = await _db
         .from('students')
         .select('*', { count: 'exact', head: true });
       return count || 0;
     },
   };
   
   /* ================================================================
      RESULTS MODULE
      ================================================================ */
   const EduResults = {
   
     /* Get results for a student in a specific term */
     async getForStudent(studentId, session, term) {
       const { data, error } = await _db
         .from('results')
         .select('*')
         .eq('student_id', studentId)
         .eq('session', session)
         .eq('term', term)
         .order('subject');
       return { data: data || [], error: error?.message };
     },
   
     /* Get all results across all students (for the dashboard table) */
     async getAll({ session = '', term = '', classFilter = '', search = '' } = {}) {
       let query = _db
         .from('results')
         .select(`
           *,
           students ( id, name, admission_no, class )
         `)
         .order('created_at', { ascending: false });
   
       if (session)     query = query.eq('session', session);
       if (term)        query = query.eq('term', term);
       if (search)      query = query.ilike('students.name', `%${search}%`);
   
       const { data, error } = await query;
       return { data: data || [], error: error?.message };
     },
   
     /* Save (upsert) results for a student — replaces existing for same term */
     async saveForStudent(studentId, session, term, subjectScores) {
       /* Delete existing results for this student/session/term first */
       await _db.from('results')
         .delete()
         .eq('student_id', studentId)
         .eq('session', session)
         .eq('term', term);
   
       /* Insert fresh rows */
       const rows = subjectScores.map(s => ({
         student_id:  studentId,
         session,
         term,
         subject:     s.subject,
         ca_score:    s.ca,
         exam_score:  s.exam,
         total_score: s.ca + s.exam,
         grade:       EduUtils.calcGrade(s.ca + s.exam),
       }));
   
       const { data, error } = await _db.from('results').insert(rows).select();
       return { data, error: error?.message };
     },
   
     /* Update a single result row */
     async update(id, fields) {
       if (fields.ca_score !== undefined || fields.exam_score !== undefined) {
         const ca   = fields.ca_score   ?? 0;
         const exam = fields.exam_score ?? 0;
         fields.total_score = ca + exam;
         fields.grade       = EduUtils.calcGrade(ca + exam);
       }
       const { data, error } = await _db
         .from('results').update(fields).eq('id', id).select().single();
       return { data, error: error?.message };
     },
   
     /* Delete a result */
     async delete(id) {
       const { error } = await _db.from('results').delete().eq('id', id);
       return { error: error?.message };
     },
   
     /* Count total results */
     async count() {
       const { count } = await _db
         .from('results')
         .select('*', { count: 'exact', head: true });
       return count || 0;
     },
   
     /* Average score across all results */
     async averageScore() {
       const { data } = await _db.from('results').select('total_score');
       if (!data || data.length === 0) return 0;
       const sum = data.reduce((acc, r) => acc + (r.total_score || 0), 0);
       return (sum / data.length).toFixed(1);
     },
   };
   
   /* ================================================================
      REPORT CARDS MODULE
      ================================================================ */
   const EduReportCards = {
   
     /* Get a student's report card for a specific term */
     async get(studentId, session, term) {
       const { data, error } = await _db
         .from('report_cards')
         .select('*')
         .eq('student_id', studentId)
         .eq('session', session)
         .eq('term', term)
         .single();
       return { data, error: error?.message };
     },
   
     /* Save or update a report card */
     async save({ studentId, session, term, totalScore, average, overallGrade,
                  position, teacherComment, principalComment }) {
   
       /* Check if one already exists */
       const { data: existing } = await _db
         .from('report_cards')
         .select('id')
         .eq('student_id', studentId)
         .eq('session', session)
         .eq('term', term)
         .single();
   
       const payload = {
         student_id:        studentId,
         session,
         term,
         total_score:       totalScore,
         average,
         overall_grade:     overallGrade,
         position:          position || null,
         teacher_comment:   teacherComment,
         principal_comment: principalComment,
         updated_at:        new Date().toISOString(),
       };
   
       let result;
       if (existing) {
         result = await _db.from('report_cards').update(payload).eq('id', existing.id).select().single();
       } else {
         result = await _db.from('report_cards').insert(payload).select().single();
       }
   
       return { data: result.data, error: result.error?.message };
     },
   
     /* Get all report cards for a student across all terms */
     async getAllForStudent(studentId) {
       const { data, error } = await _db
         .from('report_cards')
         .select('*')
         .eq('student_id', studentId)
         .order('created_at', { ascending: false });
       return { data: data || [], error: error?.message };
     },
   };
   
   /* ================================================================
      DASHBOARD STATS MODULE
      ================================================================ */
   const EduStats = {
   
     /* Load all 6 stat card values in one call */
     async loadAll(session, term) {
       const [studentCount, resultCount, avgScore, passData] = await Promise.all([
         EduStudents.count(),
         EduResults.count(),
         EduResults.averageScore(),
         _db.from('results').select('total_score').eq('session', session).eq('term', term),
       ]);
   
       const scores  = passData.data || [];
       const passed  = scores.filter(r => r.total_score >= 50).length;
       const failed  = scores.filter(r => r.total_score < 50).length;
       const attRate = 91; /* placeholder — replace with real attendance query */
   
       return { studentCount, resultCount, avgScore, passed, failed, attRate };
     },
   };
   
   /* ================================================================
      SETTINGS MODULE
      ================================================================ */
   const EduSettings = {
   
     /* Save school settings to Supabase (school_settings table) */
     async save(settings) {
       const session = await EduAuth.getSession();
       if (!session) return { error: 'Not authenticated' };
   
       const { data, error } = await _db
         .from('school_settings')
         .upsert({ id: 1, ...settings, updated_at: new Date().toISOString() })
         .select().single();
       return { data, error: error?.message };
     },
   
     /* Load school settings */
     async load() {
       const { data, error } = await _db
         .from('school_settings')
         .select('*')
         .eq('id', 1)
         .single();
       return { data, error: error?.message };
     },
   };
   
   /* ================================================================
      UTILITIES
      ================================================================ */
   const EduUtils = {
   
     /* Grade calculation — edit thresholds here */
     calcGrade(total) {
       if (total >= 80) return 'A';
       if (total >= 65) return 'B';
       if (total >= 50) return 'C';
       if (total >= 45) return 'D';
       return 'F';
     },
   
     /* Map raw Supabase student rows → shape expected by buildRow() */
     mapStudentRow(student, results = []) {
       const termResults = results.filter(r => r.student_id === student.id);
       const total = termResults.reduce((s, r) => s + (r.total_score || 0), 0);
       const avg   = termResults.length ? total / termResults.length : 0;
       return {
         id:       student.id,
         name:     student.name,
         admNo:    student.admission_no,
         class:    student.class,
         subjects: termResults.length,
         total:    Math.round(total),
         avg:      parseFloat(avg.toFixed(1)),
         grade:    this.calcGrade(avg),
         remark:   avg >= 80 ? 'Outstanding' : avg >= 65 ? 'Good' : avg >= 50 ? 'Average' : 'Needs Improvement',
         status:   avg >= 50 ? 'pass' : 'fail',
       };
     },
   
     /* Show a loading skeleton in a table body */
     showTableSkeleton(tbodyId, cols = 8) {
       const tbody = document.getElementById(tbodyId);
       if (!tbody) return;
       tbody.innerHTML = Array.from({ length: 5 }, () => `
         <tr>${Array.from({ length: cols }, () =>
           `<td><div class="skeleton" style="height:14px;border-radius:4px;background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div></td>`
         ).join('')}</tr>`).join('');
     },
   
     /* Show an error row in a table body */
     showTableError(tbodyId, msg, cols = 8) {
       const tbody = document.getElementById(tbodyId);
       if (tbody) tbody.innerHTML = `
         <tr><td colspan="${cols}" style="text-align:center;padding:40px;color:#EF4444;">
           ⚠ ${msg}
         </td></tr>`;
     },
   
     /* Show empty state */
     showTableEmpty(tbodyId, msg = 'No records found.', cols = 8) {
       const tbody = document.getElementById(tbodyId);
       if (tbody) tbody.innerHTML = `
         <tr><td colspan="${cols}" style="text-align:center;padding:40px;color:#64748B;">
           📭 ${msg}
         </td></tr>`;
     },
   };
   
   /* Add shimmer animation to document */
   const shimmerStyle = document.createElement('style');
   shimmerStyle.textContent = `@keyframes shimmer { to { background-position: -200% 0; } }`;
   document.head.appendChild(shimmerStyle);
   
   /* ================================================================
      SQL SETUP SCRIPT
      ================================================================
      Copy and paste everything below into:
      Supabase Dashboard → SQL Editor → New Query → Run
   
      -- ── Enable UUID extension ──────────────────────────────
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
   
      -- ── Admins table (linked to Supabase Auth users) ────────
      CREATE TABLE admins (
        id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
        name        TEXT,
        role        TEXT DEFAULT 'admin',
        school_name TEXT DEFAULT 'Government High School',
        created_at  TIMESTAMP DEFAULT now()
      );
   
      -- ── Students ────────────────────────────────────────────
      CREATE TABLE students (
        id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name          TEXT NOT NULL,
        admission_no  TEXT UNIQUE NOT NULL,
        class         TEXT NOT NULL,
        gender        TEXT CHECK (gender IN ('Male','Female','Other')),
        date_of_birth DATE,
        created_at    TIMESTAMP DEFAULT now()
      );
   
      -- ── Results (one row per subject per student per term) ──
      CREATE TABLE results (
        id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        student_id   UUID REFERENCES students(id) ON DELETE CASCADE,
        session      TEXT NOT NULL,
        term         TEXT NOT NULL,
        subject      TEXT NOT NULL,
        ca_score     NUMERIC(5,2) DEFAULT 0 CHECK (ca_score BETWEEN 0 AND 30),
        exam_score   NUMERIC(5,2) DEFAULT 0 CHECK (exam_score BETWEEN 0 AND 70),
        total_score  NUMERIC(5,2) GENERATED ALWAYS AS (ca_score + exam_score) STORED,
        grade        TEXT,
        created_at   TIMESTAMP DEFAULT now()
      );
   
      -- ── Report Cards (one per student per term) ─────────────
      CREATE TABLE report_cards (
        id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        student_id        UUID REFERENCES students(id) ON DELETE CASCADE,
        session           TEXT NOT NULL,
        term              TEXT NOT NULL,
        total_score       NUMERIC,
        average           NUMERIC(5,2),
        overall_grade     TEXT,
        position          TEXT,
        teacher_comment   TEXT,
        principal_comment TEXT,
        created_at        TIMESTAMP DEFAULT now(),
        updated_at        TIMESTAMP DEFAULT now()
      );
   
      -- ── School Settings ──────────────────────────────────────
      CREATE TABLE school_settings (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        school_name  TEXT DEFAULT 'Government High School',
        address      TEXT,
        phone        TEXT,
        email        TEXT,
        session      TEXT DEFAULT '2024/2025',
        term         TEXT DEFAULT '3rd Term',
        max_ca       INTEGER DEFAULT 30,
        max_exam     INTEGER DEFAULT 70,
        updated_at   TIMESTAMP DEFAULT now()
      );
   
      -- Insert default settings row
      INSERT INTO school_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
   
      -- ── Row Level Security (RLS) — required for Supabase ────
      ALTER TABLE students       ENABLE ROW LEVEL SECURITY;
      ALTER TABLE results        ENABLE ROW LEVEL SECURITY;
      ALTER TABLE report_cards   ENABLE ROW LEVEL SECURITY;
      ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE admins         ENABLE ROW LEVEL SECURITY;
   
      -- Allow authenticated users to read/write everything
      CREATE POLICY "Authenticated full access" ON students
        FOR ALL USING (auth.role() = 'authenticated');
   
      CREATE POLICY "Authenticated full access" ON results
        FOR ALL USING (auth.role() = 'authenticated');
   
      CREATE POLICY "Authenticated full access" ON report_cards
        FOR ALL USING (auth.role() = 'authenticated');
   
      CREATE POLICY "Authenticated full access" ON school_settings
        FOR ALL USING (auth.role() = 'authenticated');
   
      CREATE POLICY "Own profile" ON admins
        FOR ALL USING (auth.uid() = id);
   
      -- ── Seed demo admin (run AFTER creating the user in ─────
      --    Supabase Auth → Users → Add User with email:       ─
      --    admin@ghs.edu.ng, password: Admin@123)             ─
      INSERT INTO admins (id, name, role, school_name)
      SELECT id, 'Mr. Adebayo K.', 'superadmin', 'Government High School'
      FROM auth.users
      WHERE email = 'admin@ghs.edu.ng'
      ON CONFLICT DO NOTHING;
   
      -- ── Seed test student ────────────────────────────────────
      INSERT INTO students (name, admission_no, class, gender)
      VALUES ('Amaka Okafor', 'GHS/2025/001', 'SS 2A', 'Female')
      ON CONFLICT DO NOTHING;
   
      ================================================================ */