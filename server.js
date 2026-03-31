/**
 * Birthday Video Server
 * - Accepts video uploads from guests
 * - Saves them to Google Drive
 * - Returns the list of all uploaded videos
 * - Deploy on Railway
 */

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS: allow your GitHub Pages domain (or * for open access) ──
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Multer: store uploads temporarily on disk ──
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'), false);
  }
});

// ── Google Drive Auth ──
// Reads credentials from environment variable GOOGLE_SERVICE_ACCOUNT_JSON
function getDriveClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ── Upload endpoint ──
// POST /upload  (multipart: field "video" + optional field "caption")
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file received' });

  const caption  = req.body.caption || '';
  const origName = req.body.originalName || req.file.originalname || 'birthday-wish.mp4';

  try {
    const drive = getDriveClient();

    // 1. Upload file to Google Drive
    const driveRes = await drive.files.create({
      requestBody: {
        name: origName,
        parents: [FOLDER_ID],
        description: caption,           // store caption in Drive description
        appProperties: { caption },     // also in appProperties for easy retrieval
      },
      media: {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path),
      },
      fields: 'id, name, description, appProperties, webContentLink, webViewLink',
    });

    // 2. Make the file publicly readable
    await drive.permissions.create({
      fileId: driveRes.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    // 3. Clean up temp file
    fs.unlink(req.file.path, () => {});

    // 4. Build a streamable URL
    //    Google Drive direct stream URL format:
    const streamUrl = `https://drive.google.com/uc?export=download&id=${driveRes.data.id}`;

    res.json({
      success: true,
      video: {
        id:      driveRes.data.id,
        name:    driveRes.data.name,
        caption: caption,
        url:     streamUrl,
      }
    });

  } catch (err) {
    console.error('Upload error:', err.message);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── List videos endpoint ──
// GET /videos  →  returns all videos in the Drive folder
app.get('/videos', async (req, res) => {
  try {
    const drive = getDriveClient();

    const listRes = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType contains 'video/' and trashed = false`,
      fields: 'files(id, name, description, appProperties, createdTime)',
      orderBy: 'createdTime asc',
      pageSize: 200,
    });

    const videos = listRes.data.files.map(f => ({
      id:      f.id,
      name:    f.name,
      caption: (f.appProperties && f.appProperties.caption) || f.description || '',
      url:     `https://drive.google.com/uc?export=download&id=${f.id}`,
      createdTime: f.createdTime,
    }));

    res.json({ videos });

  } catch (err) {
    console.error('List error:', err.message);
    res.status(500).json({ error: 'Could not fetch videos: ' + err.message });
  }
});

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'ok', message: '🎂 Birthday server is running!' }));

app.listen(PORT, () => console.log(`🎉 Server running on port ${PORT}`));
