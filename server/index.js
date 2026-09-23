const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const unzipper = require('unzipper');
const crypto = require('crypto');
const util = require('util');

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

// Write to a temp file and rename over the target, so a crash mid-write
// can't leave a truncated file behind
function writeFileAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, data) {
  writeFileAtomic(file, JSON.stringify(data, null, 2));
}

// Resolve a file name to an absolute path directly inside LIBRARY_PATH, or
// return null if it would point anywhere else. Express has already
// URL-decoded route params, so names must not be decoded again.
function resolveLibraryFile(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) {
    return null;
  }
  const root = path.resolve(LIBRARY_PATH);
  const resolved = path.resolve(root, name);
  if (path.dirname(resolved) !== root) {
    return null;
  }
  return resolved;
}

// A library entry name: a PDF or Regalpaket directly inside LIBRARY_PATH.
// Also keeps names like "__proto__" out of the JSON stores.
function isLibraryFileName(name) {
  return resolveLibraryFile(name) !== null && /\.(pdf|regal)$/i.test(name);
}

function isPageNumber(value) {
  return /^[1-9]\d*$/.test(value);
}

// Pick a name that doesn't collide with an existing file: "Song.pdf" -> "Song (2).pdf"
function uniqueLibraryName(name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; fs.existsSync(path.join(LIBRARY_PATH, candidate)); n++) {
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

const SESSIONS_FILE = path.join(DATA_PATH, 'sessions.json');
const SESSION_COOKIE = 'notenregal_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

const MIN_PASSWORD_LENGTH = 8;
const PBKDF2_ITERATIONS = 210000; // OWASP recommendation for PBKDF2-HMAC-SHA512
const LEGACY_PBKDF2_ITERATIONS = 10000; // Used by auth.json files without an iterations field

const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW = 15 * 60 * 1000; // 15 minutes

const pbkdf2 = util.promisify(crypto.pbkdf2);

// Check if password has been set
function isPasswordSet() {
  return fs.existsSync(AUTH_FILE);
}

async function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, 64, 'sha512');
  return { salt, hash: hash.toString('hex'), iterations: PBKDF2_ITERATIONS };
}

async function verifyPassword(password) {
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const iterations = auth.iterations || LEGACY_PBKDF2_ITERATIONS;
  const hash = await pbkdf2(password, auth.salt, iterations, 64, 'sha512');
  const expected = Buffer.from(auth.hash, 'hex');
  const valid = hash.length === expected.length && crypto.timingSafeEqual(hash, expected);

  // Re-hash passwords stored with an older, weaker iteration count
  if (valid && iterations < PBKDF2_ITERATIONS) {
    writeJsonAtomic(AUTH_FILE, await makePasswordRecord(password));
  }
  return valid;
}

function passwordLengthError(password) {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    : null;
}

// Sessions are saved to disk so logins survive restarts. Only a hash of each
// token is stored, so the file on its own can't be used to log in.
const sessions = loadSessions();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function loadSessions() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')).sessions));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.created > SESSION_DURATION) {
      sessions.delete(key);
    }
  }
  writeJsonAtomic(SESSIONS_FILE, { sessions: Object.fromEntries(sessions) });
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(hashToken(token), { created: Date.now() });
  saveSessions();
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const key = hashToken(token);
  const session = sessions.get(key);
  if (!session) return false;
  if (Date.now() - session.created > SESSION_DURATION) {
    sessions.delete(key);
    saveSessions();
    return false;
  }
  return true;
}

// The session token lives in an HttpOnly cookie, so it never appears in URLs
// (PDF and page image requests) and page scripts can't read it
function getSessionToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return value.join('=');
    }
  }
  return null;
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    // Only mark Secure when served over HTTPS; plain-HTTP LAN setups must keep working
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: SESSION_DURATION,
    path: '/'
  });
}

// Limit password guessing to MAX_FAILED_LOGINS per client IP per window.
// Behind a reverse proxy all clients share the proxy's IP.
const failedLogins = new Map();

function loginRetryAfter(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.windowStart > FAILED_LOGIN_WINDOW) {
    return 0;
  }
  return entry.count >= MAX_FAILED_LOGINS ? entry.windowStart + FAILED_LOGIN_WINDOW - Date.now() : 0;
}

function recordFailedLogin(ip) {
  const now = Date.now();
  for (const [key, entry] of failedLogins) {
    if (now - entry.windowStart > FAILED_LOGIN_WINDOW) {
      failedLogins.delete(key);
    }
  }
  const entry = failedLogins.get(ip) || { count: 0, windowStart: now };
  entry.count++;
  failedLogins.set(ip, entry);
}

function sendTooManyAttempts(res, retryAfter) {
  const minutes = Math.ceil(retryAfter / 60000);
  res.set('Retry-After', String(Math.ceil(retryAfter / 1000)));
  res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
}

// Auth middleware
function requireAuth(req, res, next) {
  if (isValidSession(getSessionToken(req))) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Multer decodes upload file names as latin1, but browsers send UTF-8,
// turning "Brüder.pdf" into "BrÃ¼der.pdf". Re-decode when that happened.
function utf8FileName(name) {
  if (/[^\x00-\xff]/.test(name)) {
    return name; // Already decoded correctly (contains characters beyond latin1)
  }
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
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
    const name = path.basename(utf8FileName(file.originalname));
    if (!isLibraryFileName(name)) {
      return cb(new Error('Invalid file name'));
    }
    // Never overwrite an existing file (its annotations would stay attached to the name)
    cb(null, uniqueLibraryName(name));
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

app.use(express.json());

// ========================================
// AUTH ENDPOINTS (no auth required)
// ========================================

// Check if password has been set up
app.get('/api/auth/status', (req, res) => {
  res.json({ passwordSet: isPasswordSet() });
});

// Set initial password (only works if no password exists yet)
app.post('/api/auth/setup', async (req, res) => {
  try {
    const { password } = req.body;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Password required' });
    }
    const lengthError = passwordLengthError(password);
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }
    const record = await makePasswordRecord(password);
    // Checked after hashing, so two concurrent setups can't both succeed
    if (isPasswordSet()) {
      return res.status(400).json({ error: 'Password already set' });
    }
    writeJsonAtomic(AUTH_FILE, record);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Password required' });
    }
    if (!isPasswordSet()) {
      return res.status(400).json({ error: 'Password not set up yet' });
    }
    const retryAfter = loginRetryAfter(req.ip);
    if (retryAfter) {
      return sendTooManyAttempts(res, retryAfter);
    }
    if (await verifyPassword(password)) {
      failedLogins.delete(req.ip);
      setSessionCookie(req, res, createSession());
      res.json({ success: true });
    } else {
      recordFailedLogin(req.ip);
      res.status(401).json({ error: 'Invalid password' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if session is valid
app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: isValidSession(getSessionToken(req)) });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    sessions.delete(hashToken(token));
    saveSessions();
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true });
});

// Change password (requires current session)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    const retryAfter = loginRetryAfter(req.ip);
    if (retryAfter) {
      return sendTooManyAttempts(res, retryAfter);
    }
    if (!(await verifyPassword(currentPassword))) {
      recordFailedLogin(req.ip);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const lengthError = passwordLengthError(newPassword);
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }
    writeJsonAtomic(AUTH_FILE, await makePasswordRecord(newPassword));

    // Log out every other device
    const currentKey = hashToken(getSessionToken(req));
    for (const key of sessions.keys()) {
      if (key !== currentKey) {
        sessions.delete(key);
      }
    }
    saveSessions();

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
  writeJsonAtomic(SHELVES_FILE, data);
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
  writeJsonAtomic(FAVORITES_FILE, data);
}

function writeAnnotations(data) {
  writeJsonAtomic(ANNOTATIONS_FILE, data);
}

// Save or clear one page's strokes for a PDF or Regalpaket
function savePageAnnotations(fileName, pageNumber, strokes) {
  const data = readAnnotations();

  if (strokes && strokes.length > 0) {
    if (!data.annotations[fileName]) {
      data.annotations[fileName] = {};
    }
    data.annotations[fileName][pageNumber] = strokes;
  } else if (data.annotations[fileName]) {
    // Remove empty page annotations, and empty file entries
    delete data.annotations[fileName][pageNumber];
    if (Object.keys(data.annotations[fileName]).length === 0) {
      delete data.annotations[fileName];
    }
  }

  writeAnnotations(data);
}

// Point shelves, favorites and annotations at a file's new name. With
// overwriteAnnotations false, annotations already stored under newName are
// kept and oldName's stay where they are.
function moveFileReferences(oldName, newName, { overwriteAnnotations = true } = {}) {
  const shelvesData = readShelves();
  for (const shelf of shelvesData.shelves) {
    const idx = shelf.files.indexOf(oldName);
    if (idx !== -1) {
      shelf.files[idx] = newName;
    }
    shelf.files = [...new Set(shelf.files)];
  }
  writeShelves(shelvesData);

  const favoritesData = readFavorites();
  favoritesData.favorites = [...new Set(favoritesData.favorites.map(f => f === oldName ? newName : f))];
  writeFavorites(favoritesData);

  const annotationsData = readAnnotations();
  const annotations = annotationsData.annotations;
  if (annotations[oldName] && (overwriteAnnotations || !annotations[newName])) {
    annotations[newName] = annotations[oldName];
    delete annotations[oldName];
  }
  if (annotationsData.importedRegalpakete) {
    annotationsData.importedRegalpakete = annotationsData.importedRegalpakete
      .map(f => f === oldName ? newName : f);
  }
  writeAnnotations(annotationsData);
}

// Regalpakete made before annotations moved to annotations.json carry them
// inside the archive. Copy them out once per archive and remember that we
// did, so strokes the user later erases don't come back.
async function importRegalAnnotations(fileName) {
  if ((readAnnotations().importedRegalpakete || []).includes(fileName)) {
    return;
  }

  const directory = await unzipper.Open.file(resolveLibraryFile(fileName));
  const pages = {};
  for (const file of directory.files) {
    const pageNum = file.path.match(/^annotations\/page-(\d+)\.json$/)?.[1];
    if (pageNum) {
      const strokes = JSON.parse((await file.buffer()).toString());
      if (strokes.length > 0) {
        pages[pageNum] = strokes;
      }
    }
  }

  // Re-read: other requests may have written while the archive was being read
  const data = readAnnotations();
  data.importedRegalpakete = data.importedRegalpakete || [];
  if (data.importedRegalpakete.includes(fileName)) {
    return;
  }
  if (Object.keys(pages).length > 0 && !data.annotations[fileName]) {
    data.annotations[fileName] = pages;
  }
  data.importedRegalpakete.push(fileName);
  writeAnnotations(data);
}

// Import annotations from all legacy Regalpakete up front, so the library
// shows their annotation badges without opening each one first
async function importAllRegalAnnotations() {
  if (!fs.existsSync(LIBRARY_PATH)) return;
  for (const f of fs.readdirSync(LIBRARY_PATH)) {
    if (!f.toLowerCase().endsWith('.regal')) continue;
    try {
      await importRegalAnnotations(f);
    } catch (err) {
      console.error(`Failed to import annotations from ${f}:`, err.message);
    }
  }
}

// Remove leftovers from conversions interrupted by a crash or restart
function cleanupTempFiles() {
  if (!fs.existsSync(LIBRARY_PATH)) return;
  for (const f of fs.readdirSync(LIBRARY_PATH)) {
    if (f.startsWith('.temp-')) {
      try {
        fs.rmSync(path.join(LIBRARY_PATH, f), { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to remove ${f}:`, err.message);
      }
    }
  }
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

    if (typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: 'New name is required' });
    }

    // Get file extension
    const ext = path.extname(fileName).toLowerCase();
    // Ensure new name has same extension
    let finalNewName = newName.trim();
    if (!finalNewName.toLowerCase().endsWith(ext)) {
      finalNewName = finalNewName + ext;
    }

    if (!isLibraryFileName(fileName) || !isLibraryFileName(finalNewName)) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    const oldPath = resolveLibraryFile(fileName);
    const newPath = resolveLibraryFile(finalNewName);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (fs.existsSync(newPath) && oldPath !== newPath) {
      return res.status(400).json({ error: 'A file with that name already exists' });
    }

    // Rename the file
    fs.renameSync(oldPath, newPath);

    // Update shelves, favorites and annotations
    moveFileReferences(fileName, finalNewName);

    res.json({
      success: true,
      oldName: fileName,
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
    shelf.files = shelf.files.filter(f => f !== fileName);
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
    const data = readAnnotations();
    const fileAnnotations = data.annotations[fileName] || {};
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

    if (!isLibraryFileName(fileName) || !isPageNumber(pageNumber)) {
      return res.status(400).json({ error: 'Invalid file name or page number' });
    }

    savePageAnnotations(fileName, pageNumber, strokes);
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
    const data = readAnnotations();
    delete data.annotations[fileName];
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
    const data = readFavorites();
    data.favorites = data.favorites.filter(f => f !== fileName);
    writeFavorites(data);
    res.json({ success: true, favorites: data.favorites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// REGALPAKET API
// ========================================

// Resolve a Regalpaket route param to its path. Sends an error response and
// returns null if the name is invalid or the file doesn't exist.
function findRegalpaket(fileName, res) {
  const regalPath = isLibraryFileName(fileName) && fileName.toLowerCase().endsWith('.regal')
    ? resolveLibraryFile(fileName)
    : null;
  if (!regalPath) {
    res.status(400).json({ error: 'Invalid Regalpaket name' });
    return null;
  }
  if (!fs.existsSync(regalPath)) {
    res.status(404).json({ error: 'Regalpaket not found' });
    return null;
  }
  return regalPath;
}

// Convert PDF to Regalpaket
app.post('/api/regalpaket/convert/:fileName', requireAuth, async (req, res) => {
  let tempDir = null;
  let tempArchive = null;
  try {
    const { fileName } = req.params;

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF files can be converted' });
    }

    const pdfPath = resolveLibraryFile(fileName);
    if (!pdfPath) {
      return res.status(400).json({ error: 'Invalid file name' });
    }
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF file not found' });
    }

    // Dynamic import for ES module
    const { pdf } = await import('pdf-to-img');

    const baseName = fileName.replace(/\.pdf$/i, '');
    const regalName = `${baseName}.regal`;
    const regalPath = resolveLibraryFile(regalName);

    // Re-converting replaces the archive; keep any annotations stored inside the old one
    if (fs.existsSync(regalPath)) {
      await importRegalAnnotations(regalName);
    }

    // Create temp directory for conversion
    tempDir = fs.mkdtempSync(path.join(LIBRARY_PATH, '.temp-'));
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });

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

    // Build the .regal archive (zip) under a temp name and rename it into
    // place, so an interrupted conversion never leaves a half-written file
    tempArchive = `${tempDir}.zip`;
    const output = fs.createWriteStream(tempArchive);
    const archive = archiver('zip', { zlib: { level: 5 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(tempDir, false);
      archive.finalize();
    });

    fs.renameSync(tempArchive, regalPath);
    tempArchive = null;

    // Annotations are kept in annotations.json; record that this archive has none to import
    await importRegalAnnotations(regalName);

    // Point shelves, favorites and annotations at the new .regal file.
    // Annotations already on an existing .regal win; the PDF keeps its own then.
    moveFileReferences(fileName, regalName, { overwriteAnnotations: false });

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
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (tempArchive) {
      fs.rmSync(tempArchive, { force: true });
    }
  }
});

// Get Regalpaket manifest
app.get('/api/regalpaket/:fileName/manifest', requireAuth, async (req, res) => {
  try {
    const regalPath = findRegalpaket(req.params.fileName, res);
    if (!regalPath) return;

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
    const { pageNum } = req.params;
    const regalPath = findRegalpaket(req.params.fileName, res);
    if (!regalPath) return;

    if (!isPageNumber(pageNum)) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    const directory = await unzipper.Open.file(regalPath);
    const pageFile = directory.files.find(f => f.path === `pages/page-${pageNum}.png`);

    if (!pageFile) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = await pageFile.buffer();
    res.set('Content-Type', 'image/png');
    // Private: pages require login. Safe to cache long, since the client adds
    // the manifest's creation time to the URL and re-converting changes it.
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(content);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Annotations for Regalpakete live in annotations.json, keyed by file name,
// the same as for PDFs. Older archives are imported on first access.

// Get annotations for one page of a Regalpaket
app.get('/api/regalpaket/:fileName/annotations/:pageNum', requireAuth, async (req, res) => {
  try {
    const { fileName, pageNum } = req.params;
    if (!findRegalpaket(fileName, res)) return;

    await importRegalAnnotations(fileName);
    const data = readAnnotations();
    res.json(data.annotations[fileName]?.[pageNum] || []);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all annotations for a Regalpaket
app.get('/api/regalpaket/:fileName/annotations', requireAuth, async (req, res) => {
  try {
    const { fileName } = req.params;
    if (!findRegalpaket(fileName, res)) return;

    await importRegalAnnotations(fileName);
    const data = readAnnotations();
    res.json(data.annotations[fileName] || {});

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save annotations for one page of a Regalpaket
app.put('/api/regalpaket/:fileName/annotations/:pageNum', requireAuth, async (req, res) => {
  try {
    const { fileName, pageNum } = req.params;
    const { strokes } = req.body;
    if (!findRegalpaket(fileName, res)) return;

    if (!isPageNumber(pageNum)) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    // Import first, or the archive's other pages would be skipped later
    await importRegalAnnotations(fileName);
    savePageAnnotations(fileName, pageNum, strokes);
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
    if (!findRegalpaket(fileName, res)) return;

    await importRegalAnnotations(fileName);
    const data = readAnnotations();
    res.json({ hasAnnotations: Boolean(data.annotations[fileName]) });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve PDF files from library with auth
app.get('/library/:fileName', requireAuth, (req, res) => {
  try {
    const { fileName } = req.params;
    const filePath = resolveLibraryFile(fileName);

    if (!filePath) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Only serve PDF files
    if (!fileName.toLowerCase().endsWith('.pdf')) {
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

// Set the password from NOTENREGAL_PASSWORD before accepting connections, so
// nobody can claim a fresh install through the setup screen first. Only used
// while no password exists; changing it in the app takes over afterwards.
async function applyInitialPassword() {
  const password = process.env.NOTENREGAL_PASSWORD;
  if (!password || isPasswordSet()) return;
  const lengthError = passwordLengthError(password);
  if (lengthError) {
    console.error(`NOTENREGAL_PASSWORD is invalid: ${lengthError}`);
    process.exit(1);
  }
  writeJsonAtomic(AUTH_FILE, await makePasswordRecord(password));
  console.log('Password set from NOTENREGAL_PASSWORD');
}

applyInitialPassword().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Library path: ${LIBRARY_PATH}`);
    console.log(`Data path: ${DATA_PATH}`);
    initShelvesFile();
    initAnnotationsFile();
    initFavoritesFile();
    cleanupTempFiles();
    importAllRegalAnnotations();
  });
});
