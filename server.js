/**
 * Birthday Video Server
 * - Accepts video uploads from guests
 * - Saves them to Cloudinary
 * - Returns the list of all uploaded videos
 * - Deploy on Railway
 */

const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const cloudinary = require('cloudinary').v2;
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Cloudinary config (reads from environment variables) ──
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = 'birthday-wishes'; // folder name inside Cloudinary

// ── Multer: temp storage ──
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'), false);
  }
});

// ── POST /upload ──
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file received' });

  const caption = req.body.caption || '';

  try {
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'video',
      folder:        FOLDER,
      context:       `caption=${caption}`,
      eager_async:   true,
    });

    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    res.json({
      success: true,
      video: {
        id:      result.public_id,
        name:    result.original_filename,
        caption: caption,
        url:     result.secure_url,
      }
    });

  } catch (err) {
    console.error('Upload error:', err.message);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── GET /videos ──
app.get('/videos', async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression(`folder:${FOLDER} AND resource_type:video`)
      .sort_by('created_at', 'asc')
      .with_field('context')
      .max_results(200)
      .execute();

    const videos = result.resources.map(r => ({
      id:      r.public_id,
      name:    r.filename,
      caption: (r.context && r.context.caption) || '',
      url:     r.secure_url,
      createdTime: r.created_at,
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
