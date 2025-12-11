const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const unzipper = require('unzipper');
const crypto = require('crypto');

const app = express();

// Configuration via environment variables
const PORT = process.env.PORT || 3001;
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..');
const LIBRARY_PATH = process.env.LIBRARY_PATH || path.join(DATA_PATH, 'library');

// Data files stored in DATA_PATH
const SHELVES_FILE = path.join(DATA_PATH, 'shelves.json');
const ANNOTATIONS_FILE = path.join(DATA_PATH, 'annotations.json');
const AUTH_FILE = path.join(DATA_PATH, 'auth.json');
const FAVORITES_FILE = path.join(DATA_PATH, 'favorites.json');

// Session store (in-memory, will reset on server restart)
const sessions = new Map();
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

// Check if password has been set
function isPasswordSet() {
  return fs.existsSync(AUTH_FILE);
}

// Set initial password (only works if no password exists)
function setInitialPassword(password) {
  if (isPasswordSet()) {
    return false;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash }, null, 2));
  return true;
}

function verifyPassword(password) {
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const hash = crypto.pbkdf2Sync(password, auth.salt, 10000, 64, 'sha512').toString('hex');
  return hash === auth.hash;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.created > SESSION_DURATION) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (isValidSession(token)) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(LIBRARY_PATH)) {
      fs.mkdirSync(LIBRARY_PATH, { recursive: true });
    }
    cb(null, LIBRARY_PATH);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.use(cors());
app.use(express.json());

// ========================================
// AUTH ENDPOINTS (no auth required)
// ========================================

// Check if password has been set up
app.get('/api/auth/status', (req, res) => {
  res.json({ passwordSet: isPasswordSet() });
});

// Set initial password (only works if no password exists yet)
app.post('/api/auth/setup', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (isPasswordSet()) {
      return res.status(400).json({ error: 'Password already set' });
    }
    setInitialPassword(password);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }
    if (!isPasswordSet()) {
      return res.status(400).json({ error: 'Password not set up yet' });
    }
    if (verifyPassword(password)) {
      const token = createSession();
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if session is valid
app.get('/api/auth/check', (req, res) => {
  const token = req.headers['x-auth-token'];
  res.json({ authenticated: isValidSession(token) });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) {
    sessions.delete(token);
  }
  res.json({ success: true });
});

// Change password (requires current session)
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (!verifyPassword(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(newPassword, salt, 10000, 64, 'sha512').toString('hex');
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash }, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve files from library (protected)
app.use('/library', requireAuth, express.static(LIBRARY_PATH));

// Initialize shelves.json if it doesn't exist
function initShelvesFile() {
  if (!fs.existsSync(SHELVES_FILE)) {
    fs.writeFileSync(SHELVES_FILE, JSON.stringify({ shelves: [] }, null, 2));
  }
}

function readShelves() {
  initShelvesFile();
  return JSON.parse(fs.readFileSync(SHELVES_FILE, 'utf8'));
}

function writeShelves(data) {
  fs.writeFileSync(SHELVES_FILE, JSON.stringify(data, null, 2));
}

// Initialize annotations.json if it doesn't exist
function initAnnotationsFile() {
  if (!fs.existsSync(ANNOTATIONS_FILE)) {
    fs.writeFileSync(ANNOTATIONS_FILE, JSON.stringify({ annotations: {} }, null, 2));
  }
}

function readAnnotations() {
  initAnnotationsFile();
  return JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf8'));
}

function initFavoritesFile() {
  if (!fs.existsSync(FAVORITES_FILE)) {
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify({ favorites: [] }, null, 2));
  }
}

function readFavorites() {
  initFavoritesFile();
  return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8'));
}

function writeFavorites(data) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(data, null, 2));
}

function writeAnnotations(data) {
  fs.writeFileSync(ANNOTATIONS_FILE, JSON.stringify(data, null, 2));
}

// ========================================
// PROTECTED API ROUTES (require auth)
// ========================================

// Upload PDF file
app.post('/api/upload', requireAuth, upload.single('pdf'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({
      name: req.file.filename,
      path: `/library/${encodeURIComponent(req.file.filename)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all files in library (PDFs and Regalpakete)
app.get('/api/files', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(LIBRARY_PATH)) {
      fs.mkdirSync(LIBRARY_PATH, { recursive: true });
    }
    const files = fs.readdirSync(LIBRARY_PATH)
      .filter(f => f.toLowerCase().endsWith('.pdf') || f.toLowerCase().endsWith('.regal'))
      .map(f => {
        const isRegal = f.toLowerCase().endsWith('.regal');
        const stats = fs.statSync(path.join(LIBRARY_PATH, f));
        return {
          name: f,
          path: `/library/${encodeURIComponent(f)}`,
          type: isRegal ? 'regal' : 'pdf',
          mtime: stats.mtimeMs
        };
      });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename a file
app.put('/api/files/:fileName/rename', requireAuth, (req, res) => {
  try {
    const { fileName } = req.params;
    const { newName } = req.body;
    const decodedFileName = decodeURIComponent(fileName);

    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'New name is required' });
    }

    // Get file extension
    const ext = path.extname(decodedFileName).toLowerCase();
    // Ensure new name has same extension
    let finalNewName = newName.trim();
    if (!finalNewName.toLowerCase().endsWith(ext)) {
      finalNewName = finalNewName + ext;
    }

    const oldPath = path.join(LIBRARY_PATH, decodedFileName);
    const newPath = path.join(LIBRARY_PATH, finalNewName);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (fs.existsSync(newPath) && oldPath !== newPath) {
      return res.status(400).json({ error: 'A file with that name already exists' });
    }

    // Rename the file
    fs.renameSync(oldPath, newPath);

    // Update shelves references
    const shelvesData = readShelves();
    for (const shelf of shelvesData.shelves) {
      const idx = shelf.files.indexOf(decodedFileName);
      if (idx !== -1) {
        shelf.files[idx] = finalNewName;
      }
    }
    writeShelves(shelvesData);

    // Update annotations references (for PDFs)
    if (ext === '.pdf') {
      const annotationsData = readAnnotations();
      if (annotationsData.annotations[decodedFileName]) {
        annotationsData.annotations[finalNewName] = annotationsData.annotations[decodedFileName];
        delete annotationsData.annotations[decodedFileName];
        writeAnnotations(annotationsData);
      }
    }

    res.json({
      success: true,
      oldName: decodedFileName,
      newName: finalNewName,
      path: `/library/${encodeURIComponent(finalNewName)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all shelves
app.get('/api/shelves', requireAuth, (req, res) => {
  try {
    const data = readShelves();
    res.json(data.shelves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new shelf
app.post('/api/shelves', requireAuth, (req, res) => {
  try {
    const { name } = req.body;
    const data = readShelves();
    const newShelf = {
      id: `shelf-${Date.now()}`,
      name: name || 'New Shelf',
      files: []
    };
    data.shelves.push(newShelf);
    writeShelves(data);
    res.json(newShelf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a shelf (rename or update files)
app.put('/api/shelves/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { name, files } = req.body;
    const data = readShelves();
    const shelf = data.shelves.find(s => s.id === id);
    if (!shelf) {
      return res.status(404).json({ error: 'Shelf not found' });
    }
    if (name !== undefined) shelf.name = name;
    if (files !== undefined) shelf.files = files;
    writeShelves(data);
    res.json(shelf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a shelf
app.delete('/api/shelves/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const data = readShelves();
    data.shelves = data.shelves.filter(s => s.id !== id);
    writeShelves(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add file to shelf
app.post('/api/shelves/:id/files', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { fileName } = req.body;
    const data = readShelves();
    const shelf = data.shelves.find(s => s.id === id);
    if (!shelf) {
      return res.status(404).json({ error: 'Shelf not found' });
    }
    if (!shelf.files.includes(fileName)) {
      shelf.files.push(fileName);
      writeShelves(data);
    }
    res.json(shelf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove file from shelf
app.delete('/api/shelves/:id/files/:fileName', requireAuth, (req, res) => {
  try {
    const { id, fileName } = req.params;
    const data = readShelves();
    const shelf = data.shelves.find(s => s.id === id);
    if (!shelf) {
      return res.status(404).json({ error: 'Shelf not found' });
    }
    shelf.files = shelf.files.filter(f => f !== decodeURIComponent(fileName));
    writeShelves(data);
    res.json(shelf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// ANNOTATIONS API
// ========================================

// Get all annotations for a specific file
app.get('/api/annotations/:fileName', requireAuth, (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const data = readAnnotations();
    const fileAnnotations = data.annotations[decodedFileName] || {};
    res.json(fileAnnotations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save annotations for a specific page of a file
app.put('/api/annotations/:fileName/:pageNumber', requireAuth, (req, res) => {
  try {
    const { fileName, pageNumber } = req.params;
    const { strokes } = req.body;
    const decodedFileName = decodeURIComponent(fileName);

    const data = readAnnotations();

    // Initialize file entry if it doesn't exist
    if (!data.annotations[decodedFileName]) {
      data.annotations[decodedFileName] = {};
    }

    // Save or remove page annotations
    if (strokes && strokes.length > 0) {
      data.annotations[decodedFileName][pageNumber] = strokes;
    } else {
      // Remove empty page annotations
      delete data.annotations[decodedFileName][pageNumber];
      // Clean up empty file entries
      if (Object.keys(data.annotations[decodedFileName]).length === 0) {
        delete data.annotations[decodedFileName];
      }
    }

    writeAnnotations(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get list of files that have annotations (for showing indicators)
app.get('/api/annotations', requireAuth, (req, res) => {
  try {
    const data = readAnnotations();
    // Return list of filenames that have annotations
    const filesWithAnnotations = Object.keys(data.annotations);
    res.json(filesWithAnnotations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all annotations for a file
app.delete('/api/annotations/:fileName', requireAuth, (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const data = readAnnotations();
    delete data.annotations[decodedFileName];
    writeAnnotations(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// FAVORITES API
// ========================================

// Get all favorites
app.get('/api/favorites', requireAuth, (req, res) => {
  try {
    const data = readFavorites();
    res.json(data.favorites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a favorite
app.post('/api/favorites', requireAuth, (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'fileName required' });
    }
    const data = readFavorites();
    if (!data.favorites.includes(fileName)) {
      data.favorites.push(fileName);
      writeFavorites(data);
    }
    res.json({ success: true, favorites: data.favorites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a favorite
app.delete('/api/favorites/:fileName', requireAuth, (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const data = readFavorites();
    data.favorites = data.favorites.filter(f => f !== decodedFileName);
    writeFavorites(data);
    res.json({ success: true, favorites: data.favorites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// REGALPAKET API
// ========================================

// Convert PDF to Regalpaket
app.post('/api/regalpaket/convert/:fileName', requireAuth, async (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);

    if (!decodedFileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files can be converted' });
    }

    const pdfPath = path.join(LIBRARY_PATH, decodedFileName);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF file not found' });
    }

    // Dynamic import for ES module
    const { pdf } = await import('pdf-to-img');

    const baseName = decodedFileName.replace(/\.pdf$/i, '');
    const regalName = `${baseName}.regal`;
    const regalPath = path.join(LIBRARY_PATH, regalName);
    const tempDir = path.join(LIBRARY_PATH, `.temp-${Date.now()}`);

    // Create temp directory for conversion
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'annotations'), { recursive: true });

    // Convert PDF pages to images at 300 DPI
    const pdfDocument = await pdf(pdfPath, { scale: 300 / 72 }); // 300 DPI (72 is default)

    let pageNum = 0;
    const pageData = [];

    for await (const image of pdfDocument) {
      pageNum++;
      const pagePath = path.join(tempDir, 'pages', `page-${pageNum}.png`);
      fs.writeFileSync(pagePath, image);
      pageData.push({ page: pageNum, file: `page-${pageNum}.png` });
    }

    // Get existing annotations for this PDF
    const annotationsData = readAnnotations();
    const pdfAnnotations = annotationsData.annotations[decodedFileName] || {};

    // Write annotation files for each page that has annotations
    for (const [pageNumber, strokes] of Object.entries(pdfAnnotations)) {
      const annotationPath = path.join(tempDir, 'annotations', `page-${pageNumber}.json`);
      fs.writeFileSync(annotationPath, JSON.stringify(strokes, null, 2));
    }

    // Copy original PDF
    fs.copyFileSync(pdfPath, path.join(tempDir, 'original.pdf'));

    // Create manifest
    const manifest = {
      version: 1,
      name: baseName,
      created: new Date().toISOString(),
      pageCount: pageNum,
      originalFile: 'original.pdf',
      pages: pageData
    };
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Create .regal archive (zip)
    const output = fs.createWriteStream(regalPath);
    const archive = archiver('zip', { zlib: { level: 5 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(tempDir, false);
      archive.finalize();
    });

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Remove annotations from annotations.json (now stored in .regal)
    delete annotationsData.annotations[decodedFileName];
    writeAnnotations(annotationsData);

    // Update shelves to reference the new .regal file instead of .pdf
    const shelvesData = readShelves();
    for (const shelf of shelvesData.shelves) {
      const idx = shelf.files.indexOf(decodedFileName);
      if (idx !== -1) {
        shelf.files[idx] = regalName;
      }
    }
    writeShelves(shelvesData);

    // Optionally delete the original PDF (keep it for now, user can delete manually)
    // fs.unlinkSync(pdfPath);

    res.json({
      success: true,
      name: regalName,
      path: `/library/${encodeURIComponent(regalName)}`,
      pageCount: pageNum
    });

  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get Regalpaket manifest
app.get('/api/regalpaket/:fileName/manifest', requireAuth, async (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const regalPath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(regalPath)) {
      return res.status(404).json({ error: 'Regalpaket not found' });
    }

    const directory = await unzipper.Open.file(regalPath);
    const manifestFile = directory.files.find(f => f.path === 'manifest.json');

    if (!manifestFile) {
      return res.status(400).json({ error: 'Invalid Regalpaket: no manifest found' });
    }

    const content = await manifestFile.buffer();
    const manifest = JSON.parse(content.toString());
    res.json(manifest);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get page image from Regalpaket
app.get('/api/regalpaket/:fileName/page/:pageNum', requireAuth, async (req, res) => {
  try {
    const { fileName, pageNum } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const regalPath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(regalPath)) {
      return res.status(404).json({ error: 'Regalpaket not found' });
    }

    const directory = await unzipper.Open.file(regalPath);
    const pageFile = directory.files.find(f => f.path === `pages/page-${pageNum}.png`);

    if (!pageFile) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = await pageFile.buffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(content);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get annotations from Regalpaket
app.get('/api/regalpaket/:fileName/annotations/:pageNum', requireAuth, async (req, res) => {
  try {
    const { fileName, pageNum } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const regalPath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(regalPath)) {
      return res.status(404).json({ error: 'Regalpaket not found' });
    }

    const directory = await unzipper.Open.file(regalPath);
    const annotationFile = directory.files.find(f => f.path === `annotations/page-${pageNum}.json`);

    if (!annotationFile) {
      // No annotations for this page
      return res.json([]);
    }

    const content = await annotationFile.buffer();
    const strokes = JSON.parse(content.toString());
    res.json(strokes);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all annotations from Regalpaket
app.get('/api/regalpaket/:fileName/annotations', requireAuth, async (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const regalPath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(regalPath)) {
      return res.status(404).json({ error: 'Regalpaket not found' });
    }

    const directory = await unzipper.Open.file(regalPath);
    const annotationFiles = directory.files.filter(f => f.path.startsWith('annotations/') && f.path.endsWith('.json'));

    const annotations = {};
    for (const file of annotationFiles) {
      const pageNum = file.path.match(/page-(\d+)\.json/)?.[1];
      if (pageNum) {
        const content = await file.buffer();
        annotations[pageNum] = JSON.parse(content.toString());
      }
    }

    res.json(annotations);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save annotations to Regalpaket
app.put('/api/regalpaket/:fileName/annotations/:pageNum', requireAuth, async (req, res) => {
  try {
    const { fileName, pageNum } = req.params;
    const { strokes } = req.body;
    const decodedFileName = decodeURIComponent(fileName);
    const regalPath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(regalPath)) {
      return res.status(404).json({ error: 'Regalpaket not found' });
    }

    // Read existing archive
    const directory = await unzipper.Open.file(regalPath);

    // Create temp directory for reconstruction
    const tempDir = path.join(LIBRARY_PATH, `.temp-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'annotations'), { recursive: true });

    // Extract all existing files
    for (const file of directory.files) {
      if (file.type === 'File') {
        const content = await file.buffer();
        const filePath = path.join(tempDir, file.path);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content);
      }
    }

    // Update or create annotation file
    const annotationPath = path.join(tempDir, 'annotations', `page-${pageNum}.json`);
    if (strokes && strokes.length > 0) {
      fs.writeFileSync(annotationPath, JSON.stringify(strokes, null, 2));
    } else if (fs.existsSync(annotationPath)) {
      fs.unlinkSync(annotationPath);
    }

    // Recreate archive
    const output = fs.createWriteStream(regalPath);
    const archive = archiver('zip', { zlib: { level: 5 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(tempDir, false);
      archive.finalize();
    });

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    res.json({ success: true });

  } catch (err) {
    console.error('Save annotation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check if Regalpaket has any annotations
app.get('/api/regalpaket/:fileName/has-annotations', requireAuth, async (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const regalPath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(regalPath)) {
      return res.status(404).json({ error: 'Regalpaket not found' });
    }

    const directory = await unzipper.Open.file(regalPath);
    const hasAnnotations = directory.files.some(f =>
      f.path.startsWith('annotations/') && f.path.endsWith('.json')
    );

    res.json({ hasAnnotations });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve PDF files from library with auth
app.get('/library/:fileName', requireAuth, (req, res) => {
  try {
    const { fileName } = req.params;
    const decodedFileName = decodeURIComponent(fileName);
    const filePath = path.join(LIBRARY_PATH, decodedFileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Only serve PDF files
    if (!decodedFileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files can be accessed' });
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static client files in production
const CLIENT_BUILD_PATH = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_BUILD_PATH)) {
  app.use(express.static(CLIENT_BUILD_PATH));
  // Handle client-side routing - serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/library')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Library path: ${LIBRARY_PATH}`);
  console.log(`Data path: ${DATA_PATH}`);
  initShelvesFile();
  initAnnotationsFile();
  initFavoritesFile();
});
