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
 * Updated to return only events sponsored by "Pritzker Test" from org ids 50-57, and with timeslots in the requested range.
 */
app.get('/api/mobilize-events', async (req, res) => {
  console.log('=== MOBILIZE API REQUEST ===');
  console.log('Query params:', req.query);

  // Get timeMin/timeMax from query, fallback to August 2025 if missing
  let { timeMin, timeMax } = req.query;
  if (!timeMin || !timeMax) {
    // Default to August 2025
    timeMin = '2025-08-01T00:00:00Z';
    timeMax = '2025-09-01T00:00:00Z';
  }
  const start = Math.floor(new Date(timeMin).getTime() / 1000);
  const end = Math.floor(new Date(timeMax).getTime() / 1000);

  // Use production Mobilize API endpoint, filter orgs 50-57
  const orgIds = [50, 51, 52, 53, 54, 55, 56, 57];
  let url = 'https://api.mobilize.us/v1/events?';
  orgIds.forEach(id => url += `organization_id=${id}&`);
  url += `timeslot_start=gte_${start}&`;
  url += `timeslot_start=lt_${end}&`;

  console.log('Final API URL:', url);

  try {
    const response = await axios.get(url);

    // Only include events sponsored by "Pritzker Test" and timeslots in range
    const events = (response.data.data || [])
      .map(event => {
        if (!(event.sponsor && event.sponsor.name === "Pritzker Test")) return null;
        // Filter timeslots to only those in range
        const filteredTimeslots = (event.timeslots || []).filter(ts => {
          if (!ts.start_date) return false;
          return ts.start_date >= start && ts.start_date < end;
        });
        if (filteredTimeslots.length === 0) return null;
        // Return for each filtered timeslot
        return filteredTimeslots.map(timeslot => ({
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
        }));
      })
      .flat()
      .filter(Boolean);

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
      axios.get(`${req.protocol}://${req.get('host')}/api/mobilize-events`, { params: { timeMin, timeMax } }),
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