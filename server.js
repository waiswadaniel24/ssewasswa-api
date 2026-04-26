import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ADD THIS: Catch bad JSON and stop crashes
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Bad JSON received:', err.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next();
});

app.get('/', (req, res) => {
  res.json({
    message: 'Ssewasswa Backend API is running!',
    status: 'ok'
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'admin@ssewasswajuniorschool.org' && password === 'admin123') {
    res.json({
      success: true,
      token: 'fake-jwt-token-12345',
      admin: { email: email, role: 'super_admin' }
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});