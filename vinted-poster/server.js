const express = require('express');
const { postToVinted } = require('./vinted');
const fs = require('fs');

const SESSION_FILE = '/app/sessions/vinted-session.json';
const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/post-listing', async (req, res) => {
  const { images, title, description, price, category, brand, condition, size } = req.body;
  if (!images?.length) return res.status(400).json({ success: false, error: 'No images' });
  if (!title || !price) return res.status(400).json({ success: false, error: 'Missing title or price' });
  try {
    const result = await postToVinted({ images, title, description, price, category, brand, condition, size });
    res.json(result);
  } catch (err) {
    console.error('Post error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/clear-session', (req, res) => {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    res.json({ cleared: true });
  } else {
    res.json({ cleared: false });
  }
});

app.listen(3001, () => console.log('vinted-poster on port 3001'));
