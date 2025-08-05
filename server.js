require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

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
app.post('/api/org-signin', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ORG_SIGNIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Incorrect password' });
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
    console.error('Error fetching calendar events:', error?.response?.data || error.stack || error.message);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));