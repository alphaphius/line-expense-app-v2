function getRootFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty(PROP_KEYS.ROOT_FOLDER_ID);
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); } catch (ignored) { properties.deleteProperty(PROP_KEYS.ROOT_FOLDER_ID); }
  }

  const folders = DriveApp.getFoldersByName(APP_CONFIG.ROOT_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(APP_CONFIG.ROOT_FOLDER_NAME);
  properties.setProperty(PROP_KEYS.ROOT_FOLDER_ID, folder.getId());
  return folder;
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function getImageFolder_(projectName, dateIso) {
  const root = getRootFolder_();
  const projectFolder = getOrCreateChildFolder_(root, sanitizeFolderName_(projectName));
  const monthKey = (toIsoDate_(dateIso) || todayIso_()).slice(0, 7);
  const monthFolder = getOrCreateChildFolder_(projectFolder, monthKey);
  return getOrCreateChildFolder_(monthFolder, 'images');
}

function parseDataUrl_(dataUrl) {
  const match = cleanString_(dataUrl).match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error('รูปภาพไม่ถูกต้อง');
  const bytes = Utilities.base64Decode(match[2].replace(/\s/g, ''));
  const maxBytes = APP_CONFIG.MAX_FILE_MB * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน ' + APP_CONFIG.MAX_FILE_MB + ' MB');
  if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].indexOf(match[1]) < 0) {
    throw new Error('รองรับเฉพาะ JPG, PNG, WEBP และ PDF');
  }
  return { mimeType: match[1], bytes: bytes };
}

function saveUploadedFile_(filePayload, folder, sessionId, pageNo) {
  const parsed = parseDataUrl_(filePayload.dataUrl);
  const extensionMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const safeOriginal = cleanString_(filePayload.name, 100).replace(/[^\w.ก-๙-]/g, '_');
  const fileName = sessionId.slice(0, 8) + '_p' + pageNo + '_' + (safeOriginal || ('bill.' + extensionMap[parsed.mimeType]));
  const blob = Utilities.newBlob(parsed.bytes, parsed.mimeType, fileName);
  const file = folder.createFile(blob);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, parsed.bytes)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  return {
    file: file,
    blob: blob,
    record: {
      doc_id: uuid_(), bill_id: '', session_id: sessionId, page_no: pageNo,
      file_id: file.getId(), file_name: fileName, mime_type: parsed.mimeType,
      file_url: file.getUrl(), sha256: digest, size_bytes: parsed.bytes.length, created_at: nowIso_(),
      original_size_bytes: Math.max(parsed.bytes.length, toNumber_(filePayload.originalSize)),
      compression: cleanString_(filePayload.compression || 'server-validated', 60),
      width: Math.max(0, Math.trunc(toNumber_(filePayload.width))),
      height: Math.max(0, Math.trunc(toNumber_(filePayload.height))),
    },
  };
}

function optimizeStoredImageDocument_(document) {
  try {
    if (!document || !document.file_id || !/^image\//i.test(cleanString_(document.mime_type))) return document;
    const source = DriveApp.getFileById(document.file_id);
    if (source.getSize() <= APP_CONFIG.IMAGE_TARGET_BYTES) return document;
    const thumbnail = source.getThumbnail();
    if (!thumbnail) return document;
    const bytes = thumbnail.getBytes();
    if (bytes.length < 30000 || bytes.length >= source.getSize()) return document;
    const parents = source.getParents();
    const folder = parents.hasNext() ? parents.next() : getRootFolder_();
    const fileName = cleanString_(document.file_name, 100).replace(/\.[^.]+$/, '') + '_optimized.jpg';
    thumbnail.setContentType('image/jpeg').setName(fileName);
    const optimized = folder.createFile(thumbnail);
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
      .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
    const updated = updateObjectById_(SHEETS.DOCUMENTS, 'doc_id', document.doc_id, {
      file_id: optimized.getId(), file_name: fileName, mime_type: 'image/jpeg', file_url: optimized.getUrl(),
      sha256: digest, size_bytes: bytes.length, original_size_bytes: source.getSize(), compression: 'drive-thumbnail-v2',
    });
    source.setTrashed(true);
    return updated;
  } catch (error) {
    console.error('Optimize stored image: ' + error.message);
    return document;
  }
}

function optimizeStoredLineDocuments_(documents) {
  return (documents || []).map(optimizeStoredImageDocument_);
}

function getExportOptimizedBlob_(document) {
  const file = DriveApp.getFileById(document.file_id);
  const source = file.getBlob();
  const sourceBytes = source.getBytes();
  if (!/^image\//i.test(source.getContentType()) || sourceBytes.length <= APP_CONFIG.EXPORT_IMAGE_TARGET_BYTES) return source;
  try {
    const thumbnail = file.getThumbnail();
    const thumbnailBytes = thumbnail ? thumbnail.getBytes() : [];
    if (thumbnail && thumbnailBytes.length >= 30000 && thumbnailBytes.length < sourceBytes.length) {
      return thumbnail.setContentType('image/jpeg').setName(cleanString_(document.file_name).replace(/\.[^.]+$/, '') + '_export.jpg');
    }
  } catch (error) {
    console.error('Export thumbnail: ' + error.message);
  }
  return source;
}

function folderPathFor_(projectName, dateIso) {
  return [APP_CONFIG.ROOT_FOLDER_NAME, sanitizeFolderName_(projectName), (toIsoDate_(dateIso) || todayIso_()).slice(0, 7), 'images'].join('/');
}
