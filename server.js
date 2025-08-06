require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const cors = require('cors');
app.use(cors({
  origin: '*'
}));

// Health check endpoint
app.get('/', (req, res) => {
  res.send('ConnectUtahToday API is running.');
});

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// API to verify org-signin password
app.post('/api/org-signin', async (req, res) => {
  const { password } = req.body;
  try {
    // Fetch hashed password from your password table
    const result = await pool.query('SELECT password_hash FROM password LIMIT 1');
    if (result.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'No password set' });
    }
    const hashedPassword = result.rows[0].password_hash;
    const match = await bcrypt.compare(password, hashedPassword);
    if (match) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: 'Incorrect password' });
    }
  } catch (error) {
    console.error('Error verifying password:', error.stack || error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// API to get volunteer opportunities for an organization
app.get('/api/opportunities', async (req, res) => {
  const { organization } = req.query;
  try {
    const result = await pool.query(
      'SELECT opportunity FROM opportunities WHERE organization = $1',
      [organization]
    );
    res.json({ opportunities: result.rows.map(row => row.opportunity) });
  } catch (error) {
    console.error('Error fetching opportunities:', error.stack || error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// API to add a new opportunity for an organization
app.post('/api/opportunities', async (req, res) => {
  const { organization, opportunity } = req.body;
  try {
    await pool.query(
      'INSERT INTO opportunities (organization, opportunity) VALUES ($1, $2)',
      [organization, opportunity]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding opportunity:', error.stack || error);
    res.status(500).json({ error: 'Failed to add opportunity' });
  }
});

app.get('/api/calendar', async (req, res) => {
  const apiKey = process.env.GOOGLECALENDAR_API_KEY;
  const calendarId = '889b58a5eb5476990c478facc6e406cf64ca2d7ff73473cfa4b24f435b895d00@group.calendar.google.com';

  let { timeMin, timeMax } = req.query;
  if (!timeMin || !timeMax) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    timeMin = startOfMonth.toISOString();
    timeMax = endOfMonth.toISOString();
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  try {
    const response = await axios.get(url, {
      params: {
        key: apiKey,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      },
    });
    res.json(response.data);
  } catch (error) {
    // More detailed error logging
    if (error.response) {
      console.error('Error fetching calendar events:');
      console.error('Status:', error.response.status);
      console.error('Headers:', error.response.headers);
      console.error('Data:', error.response.data);
    } else if (error.request) {
      console.error('No response received from Google Calendar API.');
      console.error('Request:', error.request);
    } else {
      console.error('Error setting up request to Google Calendar API:', error.message);
    }
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

fetch('/api/org-signin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: passwordInput.value })
})
.then(res => res.json())
.then(data => {
  if (data.success) {
    // Show org form
  } else {
    // Show error
  }
});