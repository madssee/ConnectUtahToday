require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const app = express();

app.use(cors());
app.use(express.static('public')); // Use 'public' as in production
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

// API to get all organizations
app.get('/api/organizations', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM organizations ORDER BY name');
    res.json({ organizations: result.rows });
  } catch (error) {
    console.error('Error fetching organizations:', error.stack || error);
    res.status(500).json({ error: 'Could not fetch organizations' });
  }
});

// API to get volunteer opportunities for an organization by organization_id
app.get('/api/opportunities', async (req, res) => {
  const { organization_id } = req.query;
  if (!organization_id) {
    return res.status(400).json({ error: 'organization_id is required' });
  }
  try {
    const result = await pool.query(
      'SELECT opportunity FROM opportunities WHERE organization_id = $1',
      [organization_id]
    );
    res.json({ opportunities: result.rows.map(row => row.opportunity) });
  } catch (error) {
    console.error('Error fetching opportunities:', error.stack || error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// API to add a new opportunity for an organization
app.post('/api/opportunities', async (req, res) => {
  const { organization_id, opportunity } = req.body;
  if (!organization_id || !opportunity) {
    return res.status(400).json({ error: 'organization_id and opportunity are required' });
  }
  try {
    await pool.query(
      'INSERT INTO opportunities (organization_id, opportunity) VALUES ($1, $2)',
      [organization_id, opportunity]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding opportunity:', error.stack || error);
    res.status(500).json({ error: 'Failed to add opportunity' });
  }
});

/**
 * Mobilize Events API Proxy (production endpoint)
 */
app.get('/api/mobilize-events', async (req, res) => {
  console.log('=== MOBILIZE API REQUEST ===');
  console.log('Query params:', req.query);

  const { timeMin, timeMax } = req.query;
  // Convert ISO8601 to UNIX timestamp (seconds)
  const start = timeMin ? Math.floor(new Date(timeMin).getTime() / 1000) : undefined;
  const end = timeMax ? Math.floor(new Date(timeMax).getTime() / 1000) : undefined;

  console.log('Converted timestamps - start:', start, 'end:', end);

  // Use production Mobilize API endpoint
  let url = 'https://api.mobilize.us/v1/events?';
  if (start) url += `timeslot_start=gte_${start}&`;
  if (end) url += `timeslot_start=lt_${end}&`;

  console.log('Final API URL:', url);

  try {
    console.log('Making request to Mobilize API...');
    const response = await axios.get(url);

    const events = (response.data.data || []).map(event => {
      // Pick the first timeslot for display purposes
      const timeslot = (event.timeslots && event.timeslots[0]) || {};
      return {
        id: event.id,
        summary: event.title,
        description: event.description,
        date: timeslot.start_date ? new Date(timeslot.start_date * 1000).toISOString() : null,
        endDate: timeslot.end_date ? new Date(timeslot.end_date * 1000).toISOString() : null,
        image: event.featured_image_url,
        org: event.sponsor && event.sponsor.name,
        url: event.browser_url,
        event_type: event.event_type,
        source: 'mobilize'
      };
    });

    res.json({ items: events });
  } catch (error) {
    console.error('Error fetching Mobilize events:', error.message);
    res.status(500).json({ error: 'Failed to fetch Mobilize events', details: error.message });
  }
});

/**
 * Google Calendar API Proxy (production)
 */
app.get('/api/google-calendar', async (req, res) => {
  console.log('=== GOOGLE CALENDAR API REQUEST ===');
  console.log('Query params:', req.query);
  
  const { timeMin, timeMax } = req.query;
  const calendarId = '889b58a5eb5476990c478facc6e406cf64ca2d7ff73473cfa4b24f435b895d00@group.calendar.google.com';
  const apiKey = process.env.GOOGLECALENDAR_API_KEY; // Must be set in .env

  if (!apiKey) {
    console.log('Google Calendar API key not found in environment variables');
    return res.status(500).json({ error: 'Google Calendar API key not configured' });
  }

  let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${apiKey}`;
  if (timeMin) url += `&timeMin=${encodeURIComponent(timeMin)}`;
  if (timeMax) url += `&timeMax=${encodeURIComponent(timeMax)}`;
  url += '&singleEvents=true&orderBy=startTime';

  try {
    const response = await axios.get(url);

    const events = (response.data.items || []).map(event => ({
      id: event.id,
      summary: event.summary,
      description: event.description || '',
      date: event.start?.dateTime || event.start?.date,
      endDate: event.end?.dateTime || event.end?.date,
      image: null,
      org: 'Connect Utah Today',
      url: event.htmlLink,
      event_type: 'community',
      source: 'google'
    }));

    res.json({ items: events });
  } catch (error) {
    console.error('Error fetching Google Calendar events:', error.message);
    res.status(500).json({ error: 'Failed to fetch Google Calendar events', details: error.message });
  }
});

/**
 * Combined Events API (aggregates Mobilize and Google Calendar events)
 */
app.get('/api/all-events', async (req, res) => {
  console.log('=== COMBINED EVENTS REQUEST ===');
  try {
    const { timeMin, timeMax } = req.query;

    // Fetch from both APIs in parallel - use internal function calls for efficiency
    const [mobilizeResponse, googleResponse] = await Promise.all([
      // Call the Mobilize API proxy
      axios.get(`${req.protocol}://${req.get('host')}/api/mobilize-events`, { params: { timeMin, timeMax } }),
      // Call the Google Calendar API proxy
      axios.get(`${req.protocol}://${req.get('host')}/api/google-calendar`, { params: { timeMin, timeMax } })
    ]);

    let allEvents = [];
    // Add mobilize events if successful
    if (mobilizeResponse && mobilizeResponse.data && mobilizeResponse.data.items) {
      allEvents = allEvents.concat(mobilizeResponse.data.items);
    }
    // Add google events if successful
    if (googleResponse && googleResponse.data && googleResponse.data.items) {
      allEvents = allEvents.concat(googleResponse.data.items);
    }

    // Sort all events by date
    allEvents.sort((a, b) => {
      const dateA = new Date(a.date || '1970-01-01');
      const dateB = new Date(b.date || '1970-01-01');
      return dateA - dateB;
    });

    res.json({ items: allEvents });
  } catch (error) {
    console.error('Error fetching combined events:', error.message);
    res.status(500).json({ error: 'Failed to fetch combined events', details: error.message });
  }
});

/**
 * Google Calendar API (raw, for calendar page)
 * This is the same as /api/google-calendar but returns native Google response.
 */
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
    if (error.response) {
      console.error('Error fetching calendar events:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('No response from Google Calendar API:', error.request);
    } else {
      console.error('Error setting up request to Google Calendar API:', error.message);
    }
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// API to add a new organization
app.post('/api/organizations', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Organization name is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      [name]
    );
    res.json({ id: result.rows[0].id });
  } catch (error) {
    console.error('Error adding organization:', error.stack || error);
    res.status(500).json({ error: 'Could not add organization' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));