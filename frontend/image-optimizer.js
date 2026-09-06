(function () {
  'use strict';

  const defaults = Object.freeze({ maxLongEdge: 1800, targetBytes: 1200 * 1024, quality: 0.8, minQuality: 0.56 });

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsDataURL(blob);
    });
  }

  async function decodeImage(file) {
    if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('บีบอัดรูปไม่สำเร็จ')), type, quality));
  }

  async function compressImage(file, options) {
    options = Object.assign({}, defaults, options || {});
    const source = await decodeImage(file);
    const originalWidth = source.width || source.naturalWidth;
    const originalHeight = source.height || source.naturalHeight;
    let scale = Math.min(1, options.maxLongEdge / Math.max(originalWidth, originalHeight));
    let width = Math.max(1, Math.round(originalWidth * scale));
    let height = Math.max(1, Math.round(originalHeight * scale));
    let quality = options.quality;
    let blob;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, width, height);
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      canvas.width = 1;
      canvas.height = 1;
      if (blob.size <= options.targetBytes || (quality <= options.minQuality && Math.max(width, height) <= 1280)) break;
      if (quality > options.minQuality) quality = Math.max(options.minQuality, quality - 0.08);
      else {
        const currentLongEdge = Math.max(width, height);
        const nextLongEdge = Math.max(960, Math.round(currentLongEdge * 0.84));
        const resizeScale = Math.min(1, nextLongEdge / currentLongEdge);
        width = Math.max(1, Math.round(width * resizeScale));
        height = Math.max(1, Math.round(height * resizeScale));
      }
    }
    if (source.close) source.close();
    return {
      name: String(file.name || 'bill').replace(/\.[^.]+$/, '') + '.jpg',
      dataUrl: await blobToDataUrl(blob),
      originalSize: file.size,
      optimizedSize: blob.size,
      width: width,
      height: height,
      compression: 'client-jpeg-v2',
    };
  }

  async function prepareOne(file) {
    if (file.type === 'application/pdf') {
      if (file.size > 8 * 1024 * 1024) throw new Error('PDF แต่ละไฟล์ต้องมีขนาดไม่เกิน 8 MB');
      return { name: file.name, dataUrl: await blobToDataUrl(file), originalSize: file.size, optimizedSize: file.size, compression: 'none-pdf' };
    }
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('รองรับเฉพาะ JPG, PNG, WEBP และ PDF');
    return compressImage(file);
  }

  async function prepareFiles(files, onProgress) {
    const list = Array.from(files || []);
    const results = new Array(list.length);
    let nextIndex = 0;
    let completed = 0;
    let originalBytes = 0;
    let optimizedBytes = 0;
    async function worker() {
      while (nextIndex < list.length) {
        const index = nextIndex++;
        const result = await prepareOne(list[index]);
        results[index] = result;
        completed += 1;
        originalBytes += Number(result.originalSize) || 0;
        optimizedBytes += Number(result.optimizedSize) || 0;
        if (onProgress) onProgress({
          completed, total: list.length, originalBytes, optimizedBytes,
          savedPercent: originalBytes ? Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 100)) : 0,
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, list.length) }, worker));
    if (optimizedBytes > 14 * 1024 * 1024) throw new Error('ไฟล์หลังบีบอัดรวมเกิน 14 MB กรุณาแบ่งอัปโหลดเป็นหลายบิล');
    return results;
  }

  window.ImageOptimizer = Object.freeze({ compressImage, prepareFiles });
})();
