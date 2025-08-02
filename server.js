require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.static('public'));

app.get('/api/calendar', async (req, res) => {
  const apiKey = process.env.API_KEY;
  const calendarId = '889b58a5eb5476990c478facc6e406cf64ca2d7ff73473cfa4b24f435b895d00@group.calendar.google.com';

  // Get timeMin and timeMax from query parameters (optional fallback to current month)
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
    console.error('Error fetching calendar events:', error?.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));