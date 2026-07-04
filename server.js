const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Environment / DB setup
// ---------------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set.');
  console.error('Please set MONGODB_URI in your Render.com environment variables (Dashboard > Service > Environment) before starting the app.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    initAdmin();
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

// ---------------------------------------------------------------------------
// Mongoose Models
// ---------------------------------------------------------------------------
const courseSchema = new mongoose.Schema({
  name: String
});
const Course = mongoose.model('Course', courseSchema);

const subjectSchema = new mongoose.Schema({
  name: String,
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
});
const Subject = mongoose.model('Subject', subjectSchema);

const userSchema = new mongoose.Schema({
  full_name: String,
  email: String,
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['admin', 'staff', 'student'] },
  gender: String,
  address: String,
  profile_pic: { type: String, default: 'default.png' },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  session_id: String
});
const User = mongoose.model('User', userSchema);

const attendanceSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  status: String,
  date: String
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

const scoreSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  score: Number
});
const Score = mongoose.model('Score', scoreSchema);

const leaveSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: String,
  date: String,
  message: String,
  status: { type: String, default: 'Pending' },
  created_at: { type: Date, default: Date.now }
});
const Leave = mongoose.model('Leave', leaveSchema);

const notificationSchema = new mongoose.Schema({
  message: String,
  type: String,
  created_at: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

const feedbackSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  created_at: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

// ---------------------------------------------------------------------------
// Seed admin user
// ---------------------------------------------------------------------------
async function initAdmin() {
  try {
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (!existingAdmin) {
      await User.create({
        full_name: 'Administrator',
        email: 'admin@gmail.com',
        password: '123456',
        role: 'admin'
      });
      console.log('Default admin user created (admin@gmail.com / 123456)');
    }
  } catch (err) {
    console.error('Error initializing admin user:', err);
  }
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: 'secret_key_cms',
  resave: false,
  saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect('/app');
});

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error || null });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
      req.session.user = user;
      return res.redirect('/app?page=dashboard');
    }
    return res.redirect('/login?error=Invalid credentials');
  } catch (err) {
    console.error('Login error:', err);
    return res.redirect('/login?error=Database Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ---------------------------------------------------------------------------
// Shared /app handler (GET + POST)
// ---------------------------------------------------------------------------
async function appHandler(req, res) {
  try {
    const success_msg = req.query.msg || null;
    const page = req.query.page || 'dashboard';
    const user = req.session.user;

    // --- Deletion via GET query params ---
    if (req.query.delete && req.query.table && req.query.id) {
      const { table, id } = req.query;
      if (table === 'courses') {
        await Course.findByIdAndDelete(id);
      } else if (table === 'subjects') {
        await Subject.findByIdAndDelete(id);
      } else if (table === 'staff' || table === 'students') {
        await User.findByIdAndDelete(id);
      }
      return res.redirect(`/app?page=${req.query.page || page}&msg=Record deleted successfully.`);
    }

    // --- POST actions ---
    if (req.method === 'POST') {
      const action = req.body.action;
      let success_msg_out = '';

      switch (action) {
        case 'add_course': {
          await Course.create({ name: req.body.name });
          success_msg_out = 'Course added successfully.';
          break;
        }
        case 'add_subject': {
          await Subject.create({ name: req.body.name, course_id: req.body.course_id });
          success_msg_out = 'Subject added successfully.';
          break;
        }
        case 'add_staff': {
          await User.create({ ...req.body, role: 'staff' });
          success_msg_out = 'Staff member added successfully.';
          break;
        }
        case 'add_student': {
          await User.create({ ...req.body, role: 'student' });
          success_msg_out = 'Student added successfully.';
          break;
        }
        case 'save_attendance': {
          const { date, course_id, subject_id, attendance } = req.body;
          await Attendance.deleteMany({ date, subject_id, course_id });
          if (attendance) {
            const studentIds = Object.keys(attendance);
            for (const studentId of studentIds) {
              await Attendance.create({
                student_id: studentId,
                subject_id,
                course_id,
                status: attendance[studentId],
                date
              });
            }
          }
          success_msg_out = 'Attendance saved successfully.';
          break;
        }
        case 'save_scores': {
          const { subject_id, score } = req.body;
          if (score) {
            const studentIds = Object.keys(score);
            for (const studentId of studentIds) {
              const val = score[studentId];
              if (val !== undefined && val !== null && val !== '') {
                await Score.findOneAndUpdate(
                  { student_id: studentId, subject_id },
                  { score: val },
                  { upsert: true, new: true }
                );
              }
            }
          }
          success_msg_out = 'Scores saved successfully.';
          break;
        }
        case 'apply_leave': {
          const { date, message } = req.body;
          await Leave.create({ user_id: user._id, role: user.role, date, message });
          success_msg_out = 'Leave request submitted successfully.';
          break;
        }
        case 'update_leave': {
          const { leave_id, status } = req.body;
          await Leave.findByIdAndUpdate(leave_id, { status });
          success_msg_out = 'Leave status updated successfully.';
          break;
        }
        case 'send_notification': {
          const { message, type } = req.body;
          await Notification.create({ message, type });
          success_msg_out = 'Notification sent successfully.';
          break;
        }
        case 'send_feedback': {
          const { message } = req.body;
          await Feedback.create({ student_id: user._id, message });
          success_msg_out = 'Feedback submitted successfully.';
          break;
        }
        default: {
          success_msg_out = '';
        }
      }

      return res.redirect(`/app?page=${page}&msg=${success_msg_out}`);
    }

    // --- GET rendering ---
    const data = {
      user,
      page,
      success_msg,
      fetched_students: [],
      exam_students: [],
      existing_scores: {},
      existing_attendance: {}
    };

    data.courses = await Course.find({});
    data.subjects = await Subject.find({}).populate('course_id');

    if (page === 'dashboard') {
      data.total_students = await User.countDocuments({ role: 'student' });
      data.total_staff = await User.countDocuments({ role: 'staff' });
      data.total_courses = await Course.countDocuments({});
      data.total_subjects = await Subject.countDocuments({});
      data.att_count = await Attendance.countDocuments({});
      if (user.role === 'student') {
        data.total_present = await Attendance.countDocuments({ student_id: user._id, status: 'Present' });
        data.total_total = await Attendance.countDocuments({ student_id: user._id });
      }
    } else if (page === 'manage_staff') {
      data.staffs = await User.find({ role: 'staff' });
    } else if (page === 'manage_students') {
      data.students = await User.find({ role: 'student' }).populate('course_id');
    } else if (page === 'manage_attendance' || page === 'take_attendance') {
      const { fetch_course, fetch_date, fetch_subject } = req.query;
      if (fetch_course && fetch_date && fetch_subject) {
        data.fetched_students = await User.find({ role: 'student', course_id: fetch_course });
        const existingAtt = await Attendance.find({ date: fetch_date, subject_id: fetch_subject, course_id: fetch_course });
        const attMap = {};
        existingAtt.forEach((a) => {
          attMap[a.student_id.toString()] = a.status;
        });
        data.existing_attendance = attMap;
        data.fetch_date = fetch_date;
        data.fetch_course = fetch_course;
        data.fetch_subject = fetch_subject;
      }
    } else if (page === 'manage_exams') {
      const { fetch_course, fetch_subject } = req.query;
      if (fetch_course && fetch_subject) {
        data.exam_students = await User.find({ role: 'student', course_id: fetch_course });
        const existingScores = await Score.find({ subject_id: fetch_subject });
        const scoreMap = {};
        existingScores.forEach((s) => {
          scoreMap[s.student_id.toString()] = s.score;
        });
        data.existing_scores = scoreMap;
        data.fetch_course = fetch_course;
        data.fetch_subject = fetch_subject;
      }
    } else if (page === 'notifications') {
      if (user.role === 'admin') {
        data.leaves = await Leave.find({}).populate('user_id').sort('-created_at');
      }
    } else if (page === 'staff_notifs' || page === 'student_notifs') {
      const roleType = page === 'staff_notifs' ? 'staff' : 'student';
      data.notifs = await Notification.find({ type: roleType }).sort('-created_at');
    } else if (page === 'apply_leave') {
      data.my_leaves = await Leave.find({ user_id: user._id }).sort('-created_at');
    } else if (page === 'view_attendance') {
      if (user.role === 'staff') {
        data.logs = await Attendance.find({}).populate('student_id').populate('subject_id').sort('-date').limit(50);
      }
    } else if (page === 'my_attendance') {
      if (user.role === 'student') {
        data.my_att = await Attendance.find({ student_id: user._id }).populate('subject_id').sort('-date');
      }
    } else if (page === 'exam_results') {
      if (user.role === 'student') {
        data.scores = await Score.find({ student_id: user._id }).populate('subject_id');
      }
    }

    res.render('app', data);
  } catch (err) {
    console.error('Error in appHandler:', err);
    res.status(500).send('An error occurred while loading the page.');
  }
}

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).send(`Route Not Found: ${req.method} ${req.url}`);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
