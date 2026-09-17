// Ported from Rasayesh's own event/src/pages/attendance_poster/index.tsx
// (AttendancePosterPage) -- ctx.drawImage/fillText logic drawn directly onto
// a native <canvas>, NOT html2canvas. This is why the share/download/copy
// plumbing already built for the custom-template path (ReferralModal's
// handleShareConfirm) is reusable completely unchanged here: it only ever
// needed a canvas element to call .toBlob() on, never cared how the pixels
// got there.
//
// Deliberately NOT a literal copy-paste of that file's matching logic: it
// only recognizes elements whose `content` starts with FULLNAME/FIRSTNAME/
// LASTNAME/JOB. IranPharma's real template (FIRSTNAME_EN/LASTNAME_EN)
// matches fine, but Iran Cosmetica's real template uses a bare "NAME" token
// (not "FULLNAME_..."), which that exact logic would silently never draw.
// isFullnameToken() below treats a bare NAME as an alias for FULLNAME so
// both events' real templates render correctly through this one
// implementation.
//
// Our own referral-code overlay is drawn last, on top of everything else,
// using the exact same fractional-position + raw-pixel-fontSize convention
// Rasayesh's own elements already use (x/y/width/height as 0-1 fractions of
// the fixed CANVAS_SIZE canvas; fontSize is a plain px value assuming that
// same fixed canvas width -- confirmed from the pasted source: fontSize is
// passed straight through unscaled, never multiplied by canvas.width).

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

// Ported verbatim (variable names aside) from drawText2Lines in the pasted
// source -- single-line fit-or-ellipsis when maxLines===1 (used for name
// fields and our own code overlay), word-wrap-to-2-lines otherwise (used
// for the job field, matching the original).
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

// canvas: an actual <canvas> DOM node (sized by this function).
// template: the raw { editor, elements } value from Rasayesh's eventTemplate.
// attendeeData: the viewer's own attendee object (firstname_fa/lastname_fa/
//   firstname_en/lastname_en/job_title_fa/job_title_en) -- same shape
//   useAttendee() already provides elsewhere in this app.
// profilePhotoUrl: the viewer's own resolved photo URL, or null -- same
//   value QuestClient.js already computes today for the leaderboard/custom
//   share path. null here means the image slot is left empty/transparent
//   (deliberately diverging from the pasted source, which fell back to the
//   template's own baked-in default image) so the template's own background
//   design shows through instead of a placeholder.
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
  let backgroundImg = null, userImg = null;
  if (editor.background) loads.push(loadImage(`${RASAYESH_API_URL}/${editor.background}`).then((img) => { backgroundImg = img; }));
  if (profilePhotoUrl) {
    // Best-effort: a failed user-photo load must not abort the whole
    // render -- it just leaves the image slot empty (see the no-userImg
    // branch below), the same outcome as never having a photo at all --
    // unlike the background load, which is template content and should
    // fail loudly if broken.
    loads.push(loadImage(profilePhotoUrl).then((img) => { userImg = img; }).catch(() => {}));
  }
  await Promise.all(loads);

  const aspectRatio = editor.width / editor.height;
  canvas.width = CANVAS_SIZE;
  canvas.height = Math.round(CANVAS_SIZE / aspectRatio);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (backgroundImg) ctx.drawImage(backgroundImg, 0, 0, canvas.width, canvas.height);

  // No real profile photo -> draw nothing in this slot at all (leave it
  // empty/transparent) rather than falling back to the template's own
  // baked-in default image, so the design's own background (already drawn
  // above) shows through instead of a placeholder.
  if (imageElement && userImg) {
    const ix = (imageElement.left / editor.width) * canvas.width;
    const iy = (imageElement.top / editor.height) * canvas.height;
    const iw = (imageElement.width / editor.width) * canvas.width;
    const ih = (imageElement.height / editor.height) * canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ix, iy, iw, ih, [iw / 2, 0, 0, 0]);
    ctx.clip();
    ctx.drawImage(userImg, ix, iy, iw, ih);
    ctx.restore();
  }

  const fontFamily = (typeof getComputedStyle === 'function' && getComputedStyle(document.body)?.fontFamily?.split(',')[0]) || 'Arial';

  function drawTextElement(el, text, maxLines) {
    if (!el || !text) return;
    ctx.fillStyle = el.color || '#111111';
    drawText2Lines(
      ctx,
      (el.left / editor.width) * canvas.width,
      (el.top / editor.height) * canvas.height,
      (el.width / editor.width) * canvas.width,
      (el.height / editor.height) * canvas.height,
      text, fontFamily, el.fontSize, el.isBold, maxLines
    );
  }

  if (fullnameElement) {
    const l = langFor(fullnameElement, lang);
    drawTextElement(fullnameElement, `${attendeeData?.[`firstname_${l}`] || ''} ${attendeeData?.[`lastname_${l}`] || ''}`.trim(), 1);
  }
  if (firstnameElement) {
    const l = langFor(firstnameElement, lang);
    drawTextElement(firstnameElement, attendeeData?.[`firstname_${l}`] || '', 1);
  }
  if (lastnameElement) {
    const l = langFor(lastnameElement, lang);
    drawTextElement(lastnameElement, attendeeData?.[`lastname_${l}`] || '', 1);
  }
  if (jobElement) {
    const l = langFor(jobElement, lang);
    drawTextElement(jobElement, attendeeData?.[`job_title_${l}`] || '', 2);
  }

  // Our own overlay, drawn LAST so it's never obscured by anything above.
  if (overlay && code) {
    ctx.fillStyle = overlay.color || '#111111';
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
