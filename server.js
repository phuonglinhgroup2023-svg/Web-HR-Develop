const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const rootDir = __dirname;
const storageDir = path.join(rootDir, 'storage');
const sourceDir = path.join(storageDir, 'source');
const decksDir = path.join(storageDir, 'decks');
const videoDir = path.join(storageDir, 'video');
const tempDir = path.join(storageDir, 'tmp');
const manifestPath = path.join(storageDir, 'presentation-manifest.json');
const profilesPath = path.join(storageDir, 'user-profiles.json');
const accountsPath = path.join(storageDir, 'accounts.json');
const authSecretPath = path.join(storageDir, '.auth-secret');
const eventsPath = path.join(storageDir, 'user-events.json');
const adminAccountsPath = path.join(storageDir, 'admin-accounts.json');
const port = Number(process.env.PORT || 3000);
const googleSlidesBridgeUrl = process.env.GOOGLE_SLIDES_BRIDGE_URL || '';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDirRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(path.normalize(base))) {
    return null;
  }
  return targetPath;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(text);
}

function readJsonFile(filePath, fallback) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function getAuthSecret() {
  if (!fs.existsSync(authSecretPath)) fs.writeFileSync(authSecretPath, crypto.randomBytes(32).toString('hex'), 'utf8');
  return fs.readFileSync(authSecretPath, 'utf8').trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, account) {
  const storedHash = account?.passwordHash || account?.hash;
  const storedSalt = account?.passwordSalt || account?.salt;
  if (!storedHash || !storedSalt) return false;
  const candidate = crypto.scryptSync(password, storedSalt, 64).toString('hex');
  return candidate.length === storedHash.length && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(storedHash, 'hex'));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function createSessionToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getSessionEmail(req) {
  const token = parseCookies(req).recruitment_session;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? String(data.email).toLowerCase() : null;
  } catch { return null; }
}

function setSessionCookie(res, email) {
  res.setHeader('Set-Cookie', `recruitment_session=${encodeURIComponent(createSessionToken(email))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'recruitment_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function createAdminToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 7 * 86400000, scope: 'admin' })).toString('base64url');
  const signature = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getAdminEmail(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return data.scope === 'admin' && data.exp > Date.now() ? String(data.email).toLowerCase() : null; } catch { return null; }
}

function setAdminCookie(res, email) { res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(createAdminToken(email))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); }
function clearAdminCookie(res) { res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }

function publicAccount(account) {
  if (!account) return null;
  return { email: account.email, profile: account.profile || {}, createdAt: account.createdAt };
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.xml': 'application/xml; charset=utf-8',
  }[ext] || 'application/octet-stream';
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function detectVideoCodec(buffer, fileName) {
  if (!/\.mp4$/i.test(fileName)) return null;
  const header = buffer.slice(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString('latin1');
  if (header.includes('hvc1') || header.includes('hev1')) return 'HEVC/H.265';
  return null;
}

function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function readJsonBody(req, callback) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try { callback(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch (error) { callback(error); }
  });
}

async function uploadToGoogleSlides(fileName, fileData, mimeType) {
  if (!googleSlidesBridgeUrl) return null;

  // Apps Script URL Fetch POST is limited to 50 MB. Base64 adds roughly 33%.
  const encodedData = fileData.toString('base64');
  const payload = JSON.stringify({
    action: 'convert-pptx',
    fileName,
    mimeType,
    fileData: encodedData,
  });
  const payloadSize = Buffer.byteLength(payload, 'utf8');
  if (payloadSize >= 49 * 1024 * 1024) {
    throw new Error('File PPTX quá lớn cho Google Apps Script. Hãy dùng file nhỏ hơn khoảng 35 MB.');
  }

  let response;
  try {
    response = await fetch(googleSlidesBridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (error) {
    if (error?.message === 'terminated' || error?.cause?.code === 'UND_ERR_BODY_TIMEOUT') {
      throw new Error('Google Apps Script xử lý quá lâu hoặc file vượt giới hạn 50 MB. Hãy kiểm tra Executions trong Apps Script và thử file PPTX nhỏ hơn.');
    }
    throw error;
  }

  const result = await response.json();
  if (!response.ok || !result.ok || !result.embedUrl) {
    throw new Error(result.error || `Google Slides bridge returned HTTP ${response.status}`);
  }
  return result;
}

function parseMultipart(buffer, boundary) {
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const headerSep = Buffer.from('\r\n\r\n');
  const boundaryIndex = buffer.indexOf(boundaryMarker);
  if (boundaryIndex < 0) throw new Error('Boundary not found');

  const headerStart = boundaryIndex + boundaryMarker.length + 2;
  const headerEnd = buffer.indexOf(headerSep, headerStart);
  if (headerEnd < 0) throw new Error('Multipart header not found');

  const headers = buffer.slice(headerStart, headerEnd).toString('utf8');
  const fileNameMatch = headers.match(/filename="([^"]+)"/i);
  const fieldNameMatch = headers.match(/name="([^"]+)"/i);
  const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);

  const dataStart = headerEnd + headerSep.length;
  const endMarker = Buffer.from(`\r\n--${boundary}`);
  const dataEnd = buffer.indexOf(endMarker, dataStart);
  if (dataEnd < 0) throw new Error('Multipart end not found');

  return {
    fieldName: fieldNameMatch ? fieldNameMatch[1] : null,
    fileName: fileNameMatch ? fileNameMatch[1] : 'upload.pptx',
    contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
    data: buffer.slice(dataStart, dataEnd),
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(command) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { encoding: 'utf8' });
}

function extractPptxArchive(inputFile, destinationDir) {
  ensureDir(destinationDir);
  const command = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    [System.IO.Compression.ZipFile]::ExtractToDirectory(${psQuote(inputFile)}, ${psQuote(destinationDir)})
  `;
  const result = runPowerShell(command);

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Unable to extract PPTX archive');
  }
}

function parseRelationships(relsXml) {
  const relationships = new Map();
  const regex = /<Relationship\b([^>]*)\/?>/g;
  let match;

  while ((match = regex.exec(relsXml)) !== null) {
    const attrs = match[1];
    const id = (attrs.match(/\bId="([^"]+)"/i) || [null, null])[1];
    const type = (attrs.match(/\bType="([^"]+)"/i) || [null, null])[1];
    const target = (attrs.match(/\bTarget="([^"]+)"/i) || [null, null])[1];

    if (id && type && target) {
      relationships.set(id, { type, target });
    }
  }

  return relationships;
}

function extractSlideParagraphs(slideXml) {
  const paragraphs = [];
  const paragraphRegex = /<a:p\b[\s\S]*?<\/a:p>/g;
  const textRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  let paragraphMatch;

  while ((paragraphMatch = paragraphRegex.exec(slideXml)) !== null) {
    const paragraphXml = paragraphMatch[0];
    const parts = [];
    let textMatch;

    while ((textMatch = textRegex.exec(paragraphXml)) !== null) {
      parts.push(decodeXmlEntities(textMatch[1]));
    }

    const text = parts.join('').replace(/\s+/g, ' ').trim();
    if (text) {
      paragraphs.push(text);
    }
  }

  return paragraphs;
}

function buildSlideHtml({ deckId, slideNumber, title, paragraphs, imageFiles }) {
  const textBlocks = paragraphs.length
    ? paragraphs.map((paragraph) => `<p class="slide-paragraph">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
    : '<p class="slide-paragraph slide-paragraph-empty">Không trích xuất được nội dung văn bản từ slide này.</p>';

  const imageBlocks = imageFiles.length
    ? `<div class="slide-media-grid">${imageFiles.map((src) => `<figure class="slide-media-card"><img src="./media/${escapeHtml(path.basename(src))}" alt="Slide media"></figure>`).join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || `Slide ${slideNumber}`)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      color: #e2e8f0;
      background:
        radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 28%),
        radial-gradient(circle at 80% 20%, rgba(124, 58, 237, 0.18), transparent 24%),
        linear-gradient(160deg, #020617, #0f172a);
    }
    body {
      padding: 28px;
    }
    .slide-shell {
      width: 100%;
      height: 100%;
      border-radius: 28px;
      padding: clamp(24px, 4vw, 56px);
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow: auto;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(37, 99, 235, 0.16));
      border: 1px solid rgba(148, 163, 184, 0.16);
      box-shadow: 0 24px 80px rgba(2, 6, 23, 0.45);
    }
    .slide-meta {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: #7dd3fc;
      margin: 0;
    }
    h1 {
      margin: 0;
      font-size: clamp(2rem, 5vw, 4.2rem);
      line-height: 1.05;
      color: #e0f2fe;
      text-wrap: balance;
    }
    .slide-paragraph {
      margin: 0;
      font-size: clamp(1rem, 2vw, 1.2rem);
      line-height: 1.7;
      color: #cbd5e1;
      white-space: pre-wrap;
    }
    .slide-paragraph-empty {
      color: #94a3b8;
    }
    .slide-media-grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 8px;
    }
    .slide-media-card {
      margin: 0;
      border-radius: 20px;
      overflow: hidden;
      background: rgba(2, 6, 23, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.16);
      box-shadow: 0 18px 40px rgba(2, 6, 23, 0.3);
    }
    .slide-media-card img {
      display: block;
      width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <main class="slide-shell">
    <p class="slide-meta">Deck đã upload · Slide ${slideNumber}</p>
    <h1>${escapeHtml(title || `Slide ${slideNumber}`)}</h1>
    <section>
      ${textBlocks}
    </section>
    ${imageBlocks}
  </main>
</body>
</html>`;
}

function copyReferencedMedia(mediaFiles, outputDir, deckId, slideNumber) {
  const outputMediaDir = path.join(outputDir, 'media');
  ensureDir(outputMediaDir);
  const copied = [];

  for (const mediaFile of mediaFiles) {
    const fileName = `${slideNumber}-${path.basename(mediaFile)}`;
    const destination = path.join(outputMediaDir, fileName);
    fs.copyFileSync(mediaFile, destination);
    copied.push(destination);
  }

  return copied;
}

function convertPptxToSlides(inputFile, deckId) {
  const outputDir = path.join(decksDir, deckId);
  const unzipDir = path.join(tempDir, deckId);
  ensureDir(outputDir);
  removeDirRecursive(unzipDir);
  ensureDir(unzipDir);

  extractPptxArchive(inputFile, unzipDir);

  const slidesSourceDir = path.join(unzipDir, 'ppt', 'slides');
  const slideFiles = fs.readdirSync(slidesSourceDir)
    .filter((name) => /^slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = Number((a.match(/(\d+)/) || [0, 0])[1]);
      const numB = Number((b.match(/(\d+)/) || [0, 0])[1]);
      return numA - numB || a.localeCompare(b);
    });

  const htmlFiles = [];
  let slideCount = 0;

  for (const slideFile of slideFiles) {
    slideCount += 1;
    const slidePath = path.join(slidesSourceDir, slideFile);
    const relsPath = path.join(unzipDir, 'ppt', 'slides', '_rels', `${slideFile}.rels`);
    const slideXml = fs.readFileSync(slidePath, 'utf8');
    const relsXml = fs.existsSync(relsPath) ? fs.readFileSync(relsPath, 'utf8') : '';
    const paragraphs = extractSlideParagraphs(slideXml);

    const slideTitle = paragraphs[0] || `Slide ${slideCount}`;
    const imageTargets = [];
    const relationships = parseRelationships(relsXml);
    const embedRegex = /<a:blip\b[^>]*r:embed="([^"]+)"/g;
    let match;

    while ((match = embedRegex.exec(slideXml)) !== null) {
      const relationship = relationships.get(match[1]);
      if (!relationship || !/\/image$/i.test(relationship.type)) {
        continue;
      }

      const resolved = path.normalize(path.join(path.dirname(path.dirname(relsPath)), relationship.target));
      const mediaPath = safeJoin(unzipDir, path.relative(unzipDir, resolved));
      if (mediaPath && fs.existsSync(mediaPath)) {
        imageTargets.push(mediaPath);
      }
    }

    const copiedMedia = copyReferencedMedia(imageTargets, outputDir, deckId, slideCount);
    const html = buildSlideHtml({
      deckId,
      slideNumber: slideCount,
      title: slideTitle,
      paragraphs,
      imageFiles: copiedMedia,
    });

    const htmlName = `slide-${slideCount}.html`;
    fs.writeFileSync(path.join(outputDir, htmlName), html, 'utf8');
    htmlFiles.push(`/storage/decks/${deckId}/${htmlName}`);
  }

  if (!htmlFiles.length) {
    const fallbackHtml = buildSlideHtml({
      deckId,
      slideNumber: 1,
      title: 'Bản trình chiếu chưa có nội dung',
      paragraphs: [
        `Không tìm thấy slide nào trong file "${path.basename(inputFile)}".`,
        'Bạn vẫn có thể upload lại file khác hoặc kiểm tra xem file PPTX có hợp lệ không.',
      ],
      imageFiles: [],
    });
    fs.writeFileSync(path.join(outputDir, 'slide-1.html'), fallbackHtml, 'utf8');
    htmlFiles.push(`/storage/decks/${deckId}/slide-1.html`);
    slideCount = 1;
  }

  removeDirRecursive(unzipDir);

  return {
    deckId,
    outputDir,
    files: htmlFiles,
    conversionData: {
      renderMode: 'html',
      slideCount,
    },
  };
}

function clearPresentationSlot(slot = 'intro') {
  const manifest = readManifest();
  const item = manifest?.videos?.[slot];
  if (item?.videoUrl) {
    const fileName = decodeURIComponent(item.videoUrl.split('/').pop());
    const filePath = safeJoin(videoDir, fileName);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  if (!manifest) return;
  manifest.videos = { ...(manifest.videos || {}) };
  delete manifest.videos[slot];
  const intro = manifest.videos.intro;
  manifest.ready = Object.keys(manifest.videos).length > 0;
  manifest.slides = intro?.videoUrl ? [intro.videoUrl] : [];
  manifest.sourceName = intro?.sourceName || '';
  manifest.videoUrl = intro?.videoUrl || '';
  manifest.slideCount = manifest.slides.length;
  if (manifest.ready) writeManifest(manifest); else if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
}

function latestSourcePptx() {
  if (!fs.existsSync(sourceDir)) return null;
  const candidates = fs.readdirSync(sourceDir)
    .filter((name) => /\.(pptx|ppsx|ppt)$/i.test(name))
    .map((name) => {
      const fullPath = path.join(sourceDir, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.fullPath || null;
}

function needsRebuild(manifest) {
  if (!manifest?.ready || !manifest.deckId || !Array.isArray(manifest.slides) || manifest.slides.length === 0) {
    return false;
  }

  const deckDir = path.join(decksDir, manifest.deckId);
  const mediaDir = path.join(deckDir, 'media');

  if (!fs.existsSync(deckDir)) return true;
  if (!fs.existsSync(mediaDir)) return true;
  if (fs.readdirSync(mediaDir).length === 0) return true;

  return false;
}

function rebuildPresentationFromLatestSource() {
  const manifest = readManifest();
  if (!needsRebuild(manifest)) return false;

  const latestSource = latestSourcePptx();
  if (!latestSource) return false;

  try {
    if (manifest?.deckId) {
      removeDirRecursive(path.join(decksDir, manifest.deckId));
    }

    const deckId = `${Date.now()}`;
    const conversion = convertPptxToSlides(latestSource, deckId);
    const sourceName = path.basename(latestSource);
    const manifestData = {
      ready: true,
      deckId,
      sourceName,
      uploadedAt: new Date().toISOString(),
      slideCount: conversion.files.length,
      renderMode: 'html',
      slides: conversion.files,
    };

    writeManifest(manifestData);
    return true;
  } catch (error) {
    console.error('Rebuild on startup failed:', error);
    return false;
  }
}

function serveStatic(req, res, pathname) {
  const filePath = safeJoin(rootDir, pathname === '/' ? '/index.html' : pathname);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

// Video cần hỗ trợ HTTP Range để trình duyệt tải từng đoạn và phát/tua mượt.
function serveVideo(req, res, filePath) {
  const totalSize = fs.statSync(filePath).size;
  const range = req.headers.range;
  const headers = {
    'Content-Type': mimeFor(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Encoding': 'identity',
  };

  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': totalSize });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
    res.end();
    return;
  }

  const start = match[1] === '' ? 0 : Number(match[1]);
  const end = match[2] === '' ? totalSize - 1 : Math.min(Number(match[2]), totalSize - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= totalSize) {
    res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    'Content-Length': end - start + 1,
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

ensureDir(storageDir);
ensureDir(sourceDir);
ensureDir(decksDir);
ensureDir(videoDir);
ensureDir(tempDir);
rebuildPresentationFromLatestSource();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/presentation') {
    const manifest = readManifest();
    if (!manifest) {
      sendJson(res, 404, { ready: false });
      return;
    }
    if (!manifest.videos && manifest.videoUrl) {
      manifest.videos = { intro: { slot: 'intro', sourceName: manifest.sourceName || 'Video mở đầu', uploadedAt: manifest.uploadedAt, videoUrl: manifest.videoUrl } };
    }
    sendJson(res, 200, manifest);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    readJsonBody(req, (parseError, body) => {
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      if (parseError || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
        sendJson(res, 400, { ok: false, error: 'Email hoặc mật khẩu không hợp lệ.' });
        return;
      }
      const accounts = readJsonFile(accountsPath, {});
      if (accounts[email]) {
        sendJson(res, 409, { ok: false, error: 'Email này đã được đăng ký.' });
        return;
      }
      const passwordData = hashPassword(password);
      accounts[email] = { email, ...passwordData, profile: { email, completed: false }, createdAt: new Date().toISOString() };
      writeJsonFile(accountsPath, accounts);
      setSessionCookie(res, email);
      sendJson(res, 201, { ok: true, account: publicAccount(accounts[email]) });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    readJsonBody(req, (parseError, body) => {
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      const accounts = readJsonFile(accountsPath, {});
      const account = accounts[email];
      if (parseError || !account || !verifyPassword(password, account)) {
        sendJson(res, 401, { ok: false, error: 'Email hoặc mật khẩu không đúng.' });
        return;
      }
      setSessionCookie(res, email);
      sendJson(res, 200, { ok: true, account: publicAccount(account) });
    });
    return;
  }

  // Chuyển tài khoản cũ được lưu trong localStorage sang tài khoản server một lần.
  if (req.method === 'POST' && url.pathname === '/api/auth/migrate') {
    readJsonBody(req, (parseError, body) => {
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      const profile = body?.profile && typeof body.profile === 'object' ? body.profile : { email };
      if (parseError || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
        sendJson(res, 400, { ok: false, error: 'Thông tin chuyển tài khoản không hợp lệ.' });
        return;
      }
      const accounts = readJsonFile(accountsPath, {});
      if (!accounts[email]) {
        const passwordData = hashPassword(password);
        accounts[email] = { email, ...passwordData, profile: { ...profile, email }, createdAt: new Date().toISOString() };
        writeJsonFile(accountsPath, accounts);
      }
      if (!verifyPassword(password, accounts[email])) {
        sendJson(res, 401, { ok: false, error: 'Email hoặc mật khẩu không đúng.' });
        return;
      }
      setSessionCookie(res, email);
      sendJson(res, 200, { ok: true, account: publicAccount(accounts[email]), migrated: true });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const email = getSessionEmail(req);
    const accounts = readJsonFile(accountsPath, {});
    if (!email || !accounts[email]) { sendJson(res, 401, { ok: false }); return; }
    sendJson(res, 200, { ok: true, account: publicAccount(accounts[email]) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/auth/profile') {
    const email = getSessionEmail(req);
    const accounts = readJsonFile(accountsPath, {});
    if (!email || !accounts[email]) { sendJson(res, 401, { ok: false, error: 'Phiên đăng nhập đã hết hạn.' }); return; }
    readJsonBody(req, (parseError, profile) => {
      if (parseError || !profile || typeof profile !== 'object') { sendJson(res, 400, { ok: false, error: 'Hồ sơ không hợp lệ.' }); return; }
      accounts[email].profile = { ...accounts[email].profile, ...profile, email };
      writeJsonFile(accountsPath, accounts);
      sendJson(res, 200, { ok: true, account: publicAccount(accounts[email]) });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/events') {
    const email = getSessionEmail(req);
    if (!email) { sendJson(res, 401, { ok: false, error: 'Cần đăng nhập để ghi nhận hành vi.' }); return; }
    readJsonBody(req, (parseError, event) => {
      const type = String(event?.type || '').trim().toLowerCase();
      const jobId = String(event?.jobId || '').trim();
      if (parseError || !['view', 'like', 'skip', 'follow', 'apply'].includes(type) || !jobId) {
        sendJson(res, 400, { ok: false, error: 'Sự kiện không hợp lệ.' }); return;
      }
      const events = readJsonFile(eventsPath, []);
      events.push({ email, type, jobId, jobTitle: String(event.jobTitle || '').slice(0, 200), timestamp: new Date().toISOString() });
      writeJsonFile(eventsPath, events.slice(-50000));
      sendJson(res, 201, { ok: true });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/register') {
    readJsonBody(req, (parseError, body) => {
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      const admins = readJsonFile(adminAccountsPath, {});
      if (parseError || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) { sendJson(res, 400, { ok: false, error: 'Email hoặc mật khẩu admin không hợp lệ.' }); return; }
      if (admins[email]) { sendJson(res, 409, { ok: false, error: 'Admin này đã tồn tại.' }); return; }
      const passwordData = hashPassword(password);
      admins[email] = { email, ...passwordData, createdAt: new Date().toISOString() };
      writeJsonFile(adminAccountsPath, admins); setAdminCookie(res, email); sendJson(res, 201, { ok: true, email });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    readJsonBody(req, (parseError, body) => {
      const email = String(body?.email || '').trim().toLowerCase();
      const admins = readJsonFile(adminAccountsPath, {});
      if (parseError || !admins[email] || !verifyPassword(String(body?.password || ''), admins[email])) { sendJson(res, 401, { ok: false, error: 'Email hoặc mật khẩu admin không đúng.' }); return; }
      setAdminCookie(res, email); sendJson(res, 200, { ok: true, email });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/me') {
    const email = getAdminEmail(req); sendJson(res, email ? 200 : 401, email ? { ok: true, email } : { ok: false }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') { clearAdminCookie(res); sendJson(res, 200, { ok: true }); return; }

  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    if (!getAdminEmail(req)) { sendJson(res, 401, { ok: false, error: 'Cần đăng nhập admin.' }); return; }
    const accounts = readJsonFile(accountsPath, {});
    const profiles = readJsonFile(profilesPath, {});
    const events = readJsonFile(eventsPath, []);
    const users = Object.values(accounts).map((account) => ({
      email: account.email,
      profile: { ...(profiles[account.email] || {}), ...(account.profile || {}) },
      createdAt: account.createdAt,
    }));
    const byType = Object.fromEntries(['view', 'like', 'skip', 'follow', 'apply'].map((type) => [type, events.filter((event) => event.type === type).length]));
    const popularJobs = Object.values(events.reduce((result, event) => {
      const key = event.jobId;
      result[key] ||= { jobId: key, jobTitle: event.jobTitle || key, views: 0, likes: 0, skips: 0, follows: 0, applies: 0 };
      const field = `${event.type}s`;
      if (field in result[key]) result[key][field] += 1;
      return result;
    }, {})).sort((a, b) => b.views - a.views || b.likes - a.likes);
    sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), totals: { users: users.length, events: events.length, ...byType }, users, popularJobs, recentEvents: events.slice(-100).reverse() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/profile') {
    readJsonBody(req, (parseError, profile) => {
      if (parseError || !profile.email) {
        sendJson(res, 400, { ok: false, error: 'Hồ sơ không hợp lệ' });
        return;
      }
      try {
        let profiles = {};
        if (fs.existsSync(profilesPath)) profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
        profiles[profile.email.toLowerCase()] = { ...profile, updatedAt: new Date().toISOString() };
        fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf8');
        sendJson(res, 200, { ok: true });
      } catch (error) { sendJson(res, 500, { ok: false, error: error.message }); }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/clear-presentation') {
    if (!getAdminEmail(req)) { sendJson(res, 401, { ok: false, error: 'Cần đăng nhập admin.' }); return; }
    try {
      const slot = String(url.searchParams.get('slot') || 'intro');
      if (!/^[a-z0-9-]+$/.test(slot)) { sendJson(res, 400, { ok: false, error: 'Mục video không hợp lệ.' }); return; }
      clearPresentationSlot(slot);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload-presentation') {
    if (!getAdminEmail(req)) { sendJson(res, 401, { ok: false, error: 'Cần đăng nhập admin.' }); return; }
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
    if (!boundaryMatch) {
      sendJson(res, 400, { ok: false, error: 'Missing multipart boundary' });
      return;
    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const parsed = parseMultipart(buffer, boundary);
        if (!parsed.fileName) throw new Error('File name missing');

        const safeName = parsed.fileName.replace(/[<>:"/\\|?*]+/g, '_');
        if (!/\.(mp4|webm|ogg)$/i.test(safeName)) {
          throw new Error('Chỉ hỗ trợ video MP4, WebM hoặc OGG.');
        }
        const unsupportedCodec = detectVideoCodec(parsed.data, safeName);
        if (unsupportedCodec) throw new Error('Video đang dùng HEVC/H.265 (hvc1), Chrome có thể chỉ hiện màn hình đen. Hãy xuất lại video dạng MP4 H.264/AAC rồi upload lại.');
        const videoName = `${Date.now()}-${safeName}`;
        fs.writeFileSync(path.join(videoDir, videoName), parsed.data);

        const slot = String(url.searchParams.get('slot') || 'intro');
        if (!/^[a-z0-9-]+$/.test(slot)) throw new Error('Mục video không hợp lệ.');
        const manifest = readManifest() || { renderMode: 'video', videos: {} };
        manifest.renderMode = 'video';
        manifest.videos = { ...(manifest.videos || {}) };
        const videoUrl = `/storage/video/${encodeURIComponent(videoName)}`;
        manifest.videos[slot] = { slot, sourceName: parsed.fileName, uploadedAt: new Date().toISOString(), videoUrl };
        const intro = manifest.videos.intro;
        manifest.ready = true;
        manifest.sourceName = intro?.sourceName || parsed.fileName;
        manifest.uploadedAt = new Date().toISOString();
        manifest.slideCount = intro ? 1 : 0;
        manifest.videoUrl = intro?.videoUrl || '';
        manifest.slides = intro?.videoUrl ? [intro.videoUrl] : [];

        writeManifest(manifest);
        sendJson(res, 200, { ...manifest, slot });
      } catch (error) {
        console.error(error);
        sendJson(res, 500, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/storage/')) {
    const filePath = safeJoin(rootDir, url.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendText(res, 404, 'Not found');
      return;
    }
    if (/\.(mp4|webm|ogg)$/i.test(filePath)) {
      serveVideo(req, res, filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(port, () => {
  console.log(`Recruitment Story server running at http://127.0.0.1:${port}`);
});
