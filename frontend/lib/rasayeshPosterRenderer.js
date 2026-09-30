// Ported from Rasayesh's own event/src/pages/attendance_poster/index.tsx
// (AttendancePosterPage) -- ctx.drawImage/fillText logic drawn directly onto
// a native <canvas>, NOT html2canvas. This is why the share/download/copy
// plumbing already built for the custom-template path (ReferralModal's
// handleShareConfirm) is reusable completely unchanged here: it only ever
// needed a canvas element to call .toBlob() on, never cared how the pixels
// got there.
//
// Re-verified 2026-09-29 directly against Rasayesh's own minified page
// bundle (irancosmetica.com/static/scripts/pages-attendance_poster.*.js) --
// not just the earlier "pasted source" this file's history refers to.
// Confirmed byte-for-byte identical in this bundle: the photo mask
// (roundRect with corner radii [w/2,0,0,0]), the text fit/wrap algorithm
// (drawText2Lines below), the language-per-field resolution (content's
// `_xx` suffix, falling back to page language then 'fa'), and the
// font-family lookup (getComputedStyle(document.body).fontFamily). Those
// are left exactly as before.
//
// What the bundle also confirmed, and what changed here as a result: their
// render state's `image` is always `userImage || defaultImage` -- when the
// viewer has no profile photo, Rasayesh's own poster draws its OWN
// template-supplied placeholder image (the `image` field on the template's
// image element) through the exact same mask, never leaves the slot empty.
// A prior version of this file deliberately left it blank instead; that
// divergence is now removed -- see the defaultImageUrl load below.
//
// Only recognizes elements whose `content` starts with FULLNAME/FIRSTNAME/
// LASTNAME/JOB, same as Rasayesh's own bundle. isFullnameToken() also
// treats a bare "NAME" as an alias for FULLNAME -- not something the real
// bundle does (it only ever checks startsWith("FULLNAME")), kept here
// defensively in case an older or differently-configured template still
// uses that token; harmless no-op against both events' current live
// templates, which use split FIRSTNAME_EN/LASTNAME_EN fields.
//
// Our own referral-code overlay is drawn last, on top of everything else,
// using the exact same fractional-position + raw-pixel-fontSize convention
// Rasayesh's own elements already use (x/y/width/height as 0-1 fractions of
// the fixed CANVAS_SIZE canvas; fontSize is a plain px value assuming that
// same fixed canvas width -- confirmed from the bundle: fontSize is passed
// straight through unscaled, never multiplied by canvas.width).

const CANVAS_SIZE = 1024;
const RASAYESH_API_URL = 'https://api.rasayesh.com';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });
}

// "object-fit: cover", centered -- crops the source (never stretches) so it
// fills the destination box exactly, matching every other photo-fill
// convention already used in this app (RasayeshBadgeCard's CSS
// object-fit:cover, ReferralShareCanvas's CSS object-fit:cover). Rasayesh's
// own bundle does NOT do this -- it draws with the plain 4-arg drawImage,
// stretching the source to the box -- but the task here explicitly calls
// for cover/centered/not-stretched regardless of what their page does.
function drawImageCover(ctx, img, dx, dy, dw, dh) {
  const srcRatio = img.width / img.height;
  const dstRatio = dw / dh;
  let sx, sy, sw, sh;
  if (srcRatio > dstRatio) {
    sh = img.height;
    sw = sh * dstRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / dstRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Ported verbatim (variable names aside) from drawText2Lines in Rasayesh's
// own bundle -- single-line fit-or-ellipsis when maxLines===1 (used for
// name fields and our own code overlay), word-wrap-to-2-lines otherwise
// (used for the job field, matching the original). Long names are never
// shrunk to a smaller font size -- truncated with an ellipsis (1 line) or
// wrapped (2 lines then ellipsis) -- exactly as Rasayesh's own bundle does.
function drawText2Lines(ctx, x, y, w, h, text, fontFamily, fontSize, isBold, maxTextLines = 2, lineHeight = 1.5) {
  const maxLines = Math.min(Math.max(maxTextLines ?? 2, 1), 2);
  const lineH = Math.round(fontSize * lineHeight);
  ctx.font = `${isBold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = x + w / 2;
  const fitLine = (s, maxW) => {
    s = (s || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    if (ctx.measureText(s).width <= maxW) return s;
    const words = s.split(' ');
    if (words.length > 1) {
      let out = words[0];
      for (let i = 1; i < words.length; i++) {
        const t = `${out} ${words[i]}`;
        if (ctx.measureText(t).width <= maxW) out = t;
        else break;
      }
      if (ctx.measureText(out).width <= maxW) return out;
    }
    let i = 0;
    let acc = '';
    while (i < s.length && ctx.measureText(acc + s[i]).width <= maxW) acc += s[i++];
    return acc;
  };
  const line1 = fitLine(text, w);
  const fullFits = line1.length === text.trim().length;
  if (maxLines === 1 || fullFits) {
    let l1 = line1;
    if (!fullFits && maxLines === 1) {
      const ell = '…';
      while (l1 && ctx.measureText(l1 + ell).width > w) l1 = l1.slice(0, -1);
      l1 = (l1 || ell) + ell;
    }
    const cy = y + h / 2;
    ctx.fillText(l1, cx, cy);
    return;
  }
  const rest = text.slice(line1.length).trimStart();
  let line2 = fitLine(rest, w);
  if (line2.length < rest.length) {
    const ell = '…';
    while (line2 && ctx.measureText(line2 + ell).width > w) line2 = line2.slice(0, -1);
    line2 = (line2 || ell) + ell;
  }
  const totalH = (line2 ? 2 : 1) * lineH;
  const startY = y + (h - totalH) / 2 + lineH / 2;
  ctx.fillText(line1, cx, startY);
  if (line2) ctx.fillText(line2, cx, startY + lineH);
}

function isFullnameToken(content) {
  return content === 'NAME' || content.startsWith('FULLNAME');
}

function langFor(el, lang) {
  return el?.content?.split('_')[1]?.toLowerCase() || lang || 'fa';
}

// Rasayesh's own bundle assumes every text element carries a numeric
// width/height and divides straight through by them (el.width/editor.width)
// with no guard -- confirmed live: event 2's real ATTENDANCE_POSTER
// template's FIRSTNAME_EN/LASTNAME_EN elements have neither field (only
// left/top + an `isFullWidth: true` flag), which would produce NaN there
// too, not just here. Rather than reproduce that break, resolve a width
// from isFullWidth + the editor's own margins (the numbers line up exactly:
// left=141.07/141.72 sits right at marginLeft=141, and editor.width -
// marginLeft - marginRight = 200-141-13 = 46, matching a text box that
// spans the template's printable area) and a height from the font size, so
// a template missing these fields still renders instead of silently
// drawing nothing.
function resolveTextBox(el, editor) {
  const width = typeof el.width === 'number'
    ? el.width
    : el.isFullWidth
      ? Math.max(0, editor.width - (editor.marginLeft || 0) - (editor.marginRight || 0))
      : 0;
  const pxPerMm = CANVAS_SIZE / editor.width;
  const height = typeof el.height === 'number'
    ? el.height
    : Math.max(1, ((el.fontSize || 12) * (el.lineHeight || 1.5)) / pxPerMm);
  return { left: el.left, top: el.top, width, height };
}

// canvas: an actual <canvas> DOM node (sized by this function).
// template: the raw { editor, elements } value from Rasayesh's eventTemplate.
// attendeeData: the viewer's own attendee object (firstname_fa/lastname_fa/
//   firstname_en/lastname_en/job_title_fa/job_title_en) -- same shape
//   useAttendee() already provides elsewhere in this app.
// profilePhotoUrl: the viewer's own resolved photo URL, or null. null means
//   Rasayesh's own template-supplied default/placeholder image is drawn in
//   the photo slot instead (matching their own bundle's `userImage ||
//   defaultImage`) -- if the template has no image element, or its default
//   also fails to load, the slot is left empty.
// code / overlay: our own referral-code text + its admin-configured
//   { x, y, width, height, fontSize, color, isBold } position (all
//   fractions 0-1 except fontSize, same convention as every other element).
export async function renderRasayeshPoster(canvas, { template, attendeeData, profilePhotoUrl, lang, code, overlay }) {
  const { editor, elements } = template;
  const imageElement = elements.find((el) => el.type === 'image');
  const fullnameElement = elements.find((el) => el.type === 'text' && isFullnameToken(el.content));
  const firstnameElement = elements.find((el) => el.type === 'text' && el.content.startsWith('FIRSTNAME'));
  const lastnameElement = elements.find((el) => el.type === 'text' && el.content.startsWith('LASTNAME'));
  const jobElement = elements.find((el) => el.type === 'text' && el.content.startsWith('JOB'));

  const loads = [];
  let backgroundImg = null, userImg = null, defaultImg = null;
  if (editor.background) loads.push(loadImage(`${RASAYESH_API_URL}/${editor.background}`).then((img) => { backgroundImg = img; }));
  if (imageElement?.image) {
    // Template's own placeholder image -- best-effort like the user photo
    // below (a broken default shouldn't break the whole render), unlike
    // Rasayesh's own bundle which has no such guard on this specific load.
    loads.push(loadImage(`${RASAYESH_API_URL}/${imageElement.image}`).then((img) => { defaultImg = img; }).catch(() => {}));
  }
  if (profilePhotoUrl) {
    // Best-effort: a failed user-photo load must not abort the whole
    // render -- it just leaves the image slot falling back to the
    // template's default (see photoImg below), the same outcome as never
    // having a photo at all -- unlike the background load, which is
    // template content and should fail loudly if broken.
    loads.push(loadImage(profilePhotoUrl).then((img) => { userImg = img; }).catch(() => {}));
  }
  await Promise.all(loads);

  // Custom @font-face fonts in this app load with font-display:swap, so the
  // body's computed font-family can still be showing a fallback at this
  // point. Canvas text is baked in permanently at fillText time -- unlike a
  // DOM swap, it never gets redrawn once the real font finishes loading --
  // so unlike Rasayesh's own bundle (which never waits for this, since
  // their page only ever uses ordinary system/pre-loaded fonts), we do.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const aspectRatio = editor.width / editor.height;
  canvas.width = CANVAS_SIZE;
  canvas.height = Math.round(CANVAS_SIZE / aspectRatio);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (backgroundImg) ctx.drawImage(backgroundImg, 0, 0, canvas.width, canvas.height);

  // Real photo if we have one, else Rasayesh's own template-supplied
  // default/placeholder image, matching `userImage || defaultImage` in
  // their bundle -- if neither loaded, the slot is left empty.
  const photoImg = userImg || defaultImg;
  if (imageElement && photoImg) {
    const ix = (imageElement.left / editor.width) * canvas.width;
    const iy = (imageElement.top / editor.height) * canvas.height;
    const iw = (imageElement.width / editor.width) * canvas.width;
    const ih = (imageElement.height / editor.height) * canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, [iw / 2, 0, 0, 0]);
    ctx.clip();
    // Cover-fit (crop, centered, never stretched) -- see drawImageCover's
    // own comment for why this deliberately doesn't match Rasayesh's own
    // plain stretch here.
    drawImageCover(ctx, photoImg, ix, iy, iw, ih);
    ctx.restore();
  }

  const fontFamily = (typeof getComputedStyle === 'function' && getComputedStyle(document.body)?.fontFamily?.split(',')[0]) || 'Arial';

  function drawTextElement(el, text, maxLines, elLang) {
    if (!el || !text) return;
    ctx.fillStyle = el.color || '#111111';
    // The canvas can sit inside an RTL-mode ancestor (the share modal wraps
    // itself in dir={isRTL ? 'rtl' : 'ltr'}), which a 2D context's own
    // `direction` inherits by default -- explicit per-field direction here
    // keeps English content LTR and Persian content RTL regardless of the
    // surrounding modal's language. Rasayesh's own bundle never sets this
    // (their canvas is never mounted inside an RTL ancestor), so this is a
    // deliberate addition, not a ported behavior.
    ctx.direction = elLang === 'en' ? 'ltr' : 'rtl';
    const box = resolveTextBox(el, editor);
    drawText2Lines(
      ctx,
      (box.left / editor.width) * canvas.width,
      (box.top / editor.height) * canvas.height,
      (box.width / editor.width) * canvas.width,
      (box.height / editor.height) * canvas.height,
      text, fontFamily, el.fontSize, el.isBold, maxLines
    );
  }

  if (fullnameElement) {
    const l = langFor(fullnameElement, lang);
    drawTextElement(fullnameElement, `${attendeeData?.[`firstname_${l}`] || ''} ${attendeeData?.[`lastname_${l}`] || ''}`.trim(), 1, l);
  }
  if (firstnameElement) {
    const l = langFor(firstnameElement, lang);
    drawTextElement(firstnameElement, attendeeData?.[`firstname_${l}`] || '', 1, l);
  }
  if (lastnameElement) {
    const l = langFor(lastnameElement, lang);
    drawTextElement(lastnameElement, attendeeData?.[`lastname_${l}`] || '', 1, l);
  }
  if (jobElement) {
    const l = langFor(jobElement, lang);
    drawTextElement(jobElement, attendeeData?.[`job_title_${l}`] || '', 2, l);
  }

  // Our own overlay, drawn LAST so it's never obscured by anything above.
  if (overlay && code) {
    ctx.fillStyle = overlay.color || '#111111';
    ctx.direction = 'ltr'; // referral codes are always Latin/alphanumeric
    drawText2Lines(
      ctx,
      overlay.x * canvas.width,
      overlay.y * canvas.height,
      overlay.width * canvas.width,
      overlay.height * canvas.height,
      code, fontFamily, overlay.fontSize || 40, overlay.isBold !== false, 1
    );
  }
}
