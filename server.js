/**
 * Birthday Video Server
 * - Accepts video uploads from guests
 * - Saves them to Cloudinary
 * - Returns the list of all uploaded videos sorted by saved order
 * - Persists reorder by saving sort_order to each video's Cloudinary context
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

// ── Cloudinary config ──
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = 'birthday-wishes';

// ── Multer: temp storage ──
const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 200 * 1024 * 1024 },
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
    // Get current video count to assign initial sort order
    const existing = await cloudinary.search
      .expression(`folder:${FOLDER} AND resource_type:video`)
      .max_results(1)
      .execute();
    const sortOrder = existing.total_count || 0;

    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'video',
      folder:        FOLDER,
      context:       `caption=${caption}|sort_order=${sortOrder}`,
      eager_async:   true,
    });

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
// Returns videos sorted by sort_order (saved order), falling back to created_at
app.get('/videos', async (req, res) => {
  try {
    const result = await cloudinary.search
      .expression(`folder:${FOLDER} AND resource_type:video`)
      .sort_by('created_at', 'asc')
      .with_field('context')
      .max_results(200)
      .execute();

    const videos = result.resources.map(r => ({
      id:         r.public_id,
      name:       r.filename,
      caption:    (r.context && r.context.caption)    || '',
      sort_order: (r.context && r.context.sort_order) != null
                    ? parseInt(r.context.sort_order)
                    : 999999,
      url:        r.secure_url,
      createdTime: r.created_at,
    }));

    // Sort by saved sort_order, fallback to created_at order
    videos.sort((a, b) => a.sort_order - b.sort_order);

    res.json({ videos });

  } catch (err) {
    console.error('List error:', err.message);
    res.status(500).json({ error: 'Could not fetch videos: ' + err.message });
  }
});

// ── POST /reorder ──
// Body: { order: ["public_id_1", "public_id_2", ...] }
// Saves sort_order to each video's context in Cloudinary
app.post('/reorder', async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order must be a non-empty array of video IDs' });
  }

  try {
    // Update each video's sort_order in parallel
    await Promise.all(order.map((id, index) =>
      cloudinary.uploader.add_context(`sort_order=${index}`, [id], { resource_type: 'video' })
    ));

    res.json({ success: true, saved: order.length });

  } catch (err) {
    console.error('Reorder error:', err.message);
    res.status(500).json({ error: 'Reorder failed: ' + err.message });
  }
});

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'ok', message: '🎂 Birthday server is running!' }));

app.listen(PORT, () => console.log(`🎉 Server running on port ${PORT}`));
