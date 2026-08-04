/**
 * MAP GESTURE STRESS-TEST INSTRUMENTATION
 * ========================================
 * Paste this entire script into the browser DevTools console while on the /map page.
 * It installs hooks that log every gesture lifecycle event, memory snapshot,
 * backdrop-filter suppression state, React re-render triggers, and route computation
 * timing — giving Ardeshir precise data to pinpoint the intermittent crash.
 *
 * USAGE:
 *   1. Open /map in Safari (iOS) or Chrome desktop DevTools
 *   2. Paste this script in the Console tab
 *   3. Reproduce the crash scenario (or run AUTO-TEST below)
 *   4. Copy the log output from console and report back
 *
 * The script is read-only — it does NOT modify the page's state or DOM.
 */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const LOG_PREFIX = '[MAP-STRESS]';
  const SAMPLE_INTERVAL_MS = 500; // memory/GPU snapshot interval during stress
  const MAX_LOG_LINES = 2000;

  // ── Internal state ────────────────────────────────────────────────────────
  let logs = [];
  let frameCount = 0;
  let lastFrameTime = performance.now();
  let fpsMonitorId = null;
  let memSampleId = null;
  let gestureActive = false;
  let gestureCount = 0;
  let renderCount = 0;
  let lastGestureStart = 0;
  let maxGestureDuration = 0;
  let crashRiskLevel = 0;

  function log(category, msg, data) {
    const entry = {
      t: (performance.now() / 1000).toFixed(3) + 's',
      cat: category,
      msg,
      ...(data ? { data } : {}),
    };
    logs.push(entry);
    if (logs.length > MAX_LOG_LINES) logs.shift();

    const style = {
      GESTURE: 'color:#00ffb3;font-weight:bold',
      MEMORY:  'color:#f59e0b',
      PERF:    'color:#60a5fa',
      REACT:   'color:#c084fc',
      RISK:    'color:#ef4444;font-weight:bold',
      DOM:     'color:#a3e635',
      ROUTE:   'color:#fb923c',
      OK:      'color:#4ade80',
    }[category] || 'color:#ffffff';

    if (data) {
      console.log(`%c${LOG_PREFIX} [${entry.t}] [${category}] ${msg}`, style, data);
    } else {
      console.log(`%c${LOG_PREFIX} [${entry.t}] [${category}] ${msg}`, style);
    }
  }

  // ── Memory snapshot ───────────────────────────────────────────────────────
  function snapMemory(label) {
    const info = {};

    // JS heap (Chrome only)
    if (performance.memory) {
      info.jsHeapUsedMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
      info.jsHeapTotalMB = (performance.memory.totalJSHeapSize / 1048576).toFixed(1);
      info.jsHeapLimitMB = (performance.memory.jsHeapSizeLimit / 1048576).toFixed(1);
      const pct = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
      info.heapPct = pct + '%';

      if (pct > 70) {
        crashRiskLevel = Math.max(crashRiskLevel, 2);
        log('RISK', `JS heap at ${pct}% — crash risk elevated`, info);
      }
    }

    // WebGL info (GPU memory estimate)
    const canvases = document.querySelectorAll('canvas');
    info.canvasCount = canvases.length;
    canvases.forEach((c, i) => {
      const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          info[`canvas${i}_renderer`] = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          info[`canvas${i}_vendor`]   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        }
        info[`canvas${i}_size`] = `${c.width}×${c.height}`;
        // Estimate framebuffer memory: w×h×4 bytes×2 (front+back) + MSAA overhead
        const fbMB = (c.width * c.height * 8 / 1048576).toFixed(1);
        info[`canvas${i}_estimatedFramebufferMB`] = fbMB;
      }
    });

    // Count backdrop-filter active elements
    const bdElements = countBackdropFilters();
    info.backdropFilterElements = bdElements.count;
    info.backdropFilterSuppressed = bdElements.suppressed;
    info.backdropFilterActive = bdElements.active;

    if (bdElements.active > 0 && gestureActive) {
      crashRiskLevel = Math.max(crashRiskLevel, 3);
      log('RISK',
        `CRITICAL: ${bdElements.active} backdrop-filter elements ACTIVE during gesture!`,
        { active: bdElements.activeList }
      );
    }

    log('MEMORY', label, info);
    return info;
  }

  // ── Backdrop-filter audit ─────────────────────────────────────────────────
  function countBackdropFilters() {
    const all = document.querySelectorAll('*');
    let count = 0, suppressed = 0, active = 0;
    const activeList = [];

    for (const el of all) {
      const style = window.getComputedStyle(el);
      const bf = style.backdropFilter || style.webkitBackdropFilter || '';
      if (bf && bf !== 'none') {
        count++;
        // Check if it's inside a .map-gesture-active subtree
        if (el.closest('.map-gesture-active')) {
          suppressed++;
        } else {
          active++;
          activeList.push({
            tag: el.tagName,
            classes: el.className?.toString().slice(0, 80),
            bf: bf.slice(0, 40),
            inert: el.closest('[inert]') ? 'inert' : 'live',
          });
        }
      }
    }

    return { count, suppressed, active, activeList };
  }

  // ── gesture-active class observer ─────────────────────────────────────────
  function findPageRoot() {
    // MapClient renders pageRootRef on the first flex-col div with 100dvh height
    return document.querySelector('[style*="100dvh"]') ||
           document.querySelector('.flex.flex-col') ||
           document.body;
  }

  const pageRoot = findPageRoot();
  if (!pageRoot) {
    log('DOM', 'WARNING: Could not find pageRootRef — gesture-active monitoring disabled');
  } else {
    const classObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          const hasGestureActive = m.target.classList.contains('map-gesture-active');
          if (hasGestureActive && !gestureActive) {
            gestureActive = true;
            gestureCount++;
            lastGestureStart = performance.now();
            log('GESTURE', `Gesture ${gestureCount} START — backdrop-filter suppressed on ${pageRoot.tagName}`);
            snapMemory(`pre-gesture-${gestureCount}`);
          } else if (!hasGestureActive && gestureActive) {
            gestureActive = false;
            const dur = performance.now() - lastGestureStart;
            maxGestureDuration = Math.max(maxGestureDuration, dur);
            log('GESTURE', `Gesture ${gestureCount} END — duration ${dur.toFixed(0)}ms`);
            snapMemory(`post-gesture-${gestureCount}`);
          }
        }
      }
    });
    classObserver.observe(pageRoot, { attributes: true, attributeFilter: ['class'] });
    log('DOM', 'pageRootRef found — gesture-active class observer installed', {
      element: `${pageRoot.tagName}.${[...pageRoot.classList].join('.')}`,
    });
  }

  // ── FPS monitor ───────────────────────────────────────────────────────────
  let fpsSamples = [];
  function measureFPS(now) {
    frameCount++;
    const dt = now - lastFrameTime;
    if (dt >= 1000) {
      const fps = Math.round((frameCount / dt) * 1000);
      fpsSamples.push(fps);
      if (fps < 30 && gestureActive) {
        crashRiskLevel = Math.max(crashRiskLevel, 2);
        log('PERF', `LOW FPS during gesture: ${fps} fps — GPU under pressure`);
      } else if (fps < 15) {
        crashRiskLevel = Math.max(crashRiskLevel, 3);
        log('RISK', `CRITICAL LOW FPS: ${fps} fps — likely to crash`);
      }
      frameCount = 0;
      lastFrameTime = now;
    }
    fpsMonitorId = requestAnimationFrame(measureFPS);
  }
  fpsMonitorId = requestAnimationFrame(measureFPS);

  // ── Intercept fetch to detect in-flight requests during gestures ──────────
  const origFetch = window.fetch;
  window.fetch = function (url, opts) {
    const urlStr = typeof url === 'string' ? url : url?.url || String(url);
    const isMapApi = urlStr.includes('/api/map') || urlStr.includes('/api/quest');
    if (isMapApi && gestureActive) {
      log('ROUTE', `fetch during ACTIVE gesture: ${urlStr}`, {
        gestureCount, url: urlStr,
      });
    }
    const start = performance.now();
    return origFetch.apply(this, arguments).then(res => {
      const dur = (performance.now() - start).toFixed(0);
      if (isMapApi) {
        log('ROUTE', `fetch resolved: ${urlStr} in ${dur}ms`, {
          status: res.status, gestureWasActive: gestureActive,
        });
      }
      return res;
    }).catch(err => {
      if (isMapApi) log('ROUTE', `fetch FAILED: ${urlStr}`, { error: err.message });
      throw err;
    });
  };

  // ── Intercept setTimeout to detect long-blocking callbacks ───────────────
  const origSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, delay, ...args) {
    const wrapped = function (...cbArgs) {
      const start = performance.now();
      const result = fn.apply(this, cbArgs);
      const dur = performance.now() - start;
      if (dur > 200) {
        log('PERF', `Long setTimeout callback: ${dur.toFixed(0)}ms (delay was ${delay}ms)`, {
          fnName: fn.name || '(anonymous)',
          gestureActiveAtCallTime: gestureActive,
        });
        if (dur > 1000) {
          crashRiskLevel = Math.max(crashRiskLevel, 2);
          log('RISK', `Main thread BLOCKED ${dur.toFixed(0)}ms — likely buildFloorGrids or heavy A* compute`);
        }
      }
      return result;
    };
    return origSetTimeout.call(this, wrapped, delay, ...args);
  };

  // ── Intercept requestAnimationFrame to count render frames per second ─────
  let rafCallCount = 0;
  const origRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    const wrapped = function (ts) {
      rafCallCount++;
      return cb(ts);
    };
    return origRAF.call(this, wrapped);
  };

  // ── DOM MutationObserver: detect component mount/unmount ──────────────────
  const mountObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          // Canvas added → Three.js renderer mounted (3D mode)
          if (node.tagName === 'CANVAS') {
            renderCount++;
            log('REACT', `Three.js canvas MOUNTED (render #${renderCount})`, {
              size: `${node.width}×${node.height}`,
              gestureActive,
            });
            snapMemory(`canvas-mount-${renderCount}`);
          }
          // Fixed overlay added (sheets, panels)
          const style = node.className?.toString() || '';
          if (style.includes('fixed') && style.includes('inset')) {
            log('DOM', `Fixed overlay ADDED: ${node.tagName}`, {
              classes: style.slice(0, 80),
              gestureActive,
            });
          }
        }
      }
      for (const node of m.removedNodes) {
        if (node.nodeType === 1) {
          if (node.tagName === 'CANVAS') {
            log('REACT', `Three.js canvas UNMOUNTED`, { gestureActive });
            // Small delay to let renderer.dispose() run, then check memory
            origSetTimeout(() => snapMemory('canvas-unmount'), 200);
          }
        }
      }
    }
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });

  // ── Periodic memory sampling ──────────────────────────────────────────────
  memSampleId = setInterval(() => {
    if (gestureActive) snapMemory('mid-gesture-sample');
  }, SAMPLE_INTERVAL_MS);

  // ── Initial state snapshot ────────────────────────────────────────────────
  log('OK', '=== MAP STRESS TEST INSTRUMENTATION ACTIVE ===');
  snapMemory('initial-state');

  const bdAudit = countBackdropFilters();
  log('DOM', 'Initial backdrop-filter audit', bdAudit);
  if (bdAudit.active > 0) {
    log('DOM', 'Active backdrop-filter elements found at rest:', bdAudit.activeList);
  }

  // ── AUTO-TEST: simulate rapid zoom events (keyboard-triggered) ───────────
  // Press 'T' to run a 20-cycle rapid zoom simulation (desktop/Chrome only)
  // Press 'M' to dump the current memory snapshot
  // Press 'R' to dump the full log as JSON
  // Press 'C' to clear and reset counters
  window.addEventListener('keydown', (e) => {
    if (e.key === 'T' || e.key === 't') {
      log('GESTURE', '=== AUTO-TEST: 20-cycle rapid wheel zoom starting ===');
      const mapContainer = document.querySelector('[style*="touch-action: none"]') ||
                           document.querySelector('[style*="touchAction"]');
      if (!mapContainer) {
        log('GESTURE', 'Could not find map container — manual testing only');
        return;
      }
      let cycle = 0;
      function fireWheelCycle() {
        if (cycle >= 20) {
          log('GESTURE', '=== AUTO-TEST: complete ===', {
            totalGestures: gestureCount,
            maxGestureDuration: maxGestureDuration.toFixed(0) + 'ms',
            crashRiskLevel,
          });
          snapMemory('auto-test-complete');
          return;
        }
        // Alternating zoom-in / zoom-out
        const delta = cycle % 2 === 0 ? -100 : 100;
        const rect = mapContainer.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const evt = new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          clientX: cx, clientY: cy,
          deltaY: delta, deltaMode: 0,
        });
        mapContainer.dispatchEvent(evt);
        cycle++;
        origSetTimeout(fireWheelCycle, 80); // 80ms between zooms → ~12 per second
      }
      fireWheelCycle();
    }

    if (e.key === 'M' || e.key === 'm') {
      snapMemory('manual-snapshot');
    }

    if (e.key === 'R' || e.key === 'r') {
      const report = {
        totalGestures: gestureCount,
        maxGestureDuration: maxGestureDuration + 'ms',
        crashRiskLevel,
        avgFPS: fpsSamples.length
          ? (fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length).toFixed(1)
          : 'n/a',
        minFPS: fpsSamples.length ? Math.min(...fpsSamples) : 'n/a',
        logCount: logs.length,
        logs,
      };
      console.log('%c[MAP-STRESS] FULL REPORT:', 'color:#00ffb3;font-size:14px;font-weight:bold', report);
      console.log('[MAP-STRESS] Copy via: copy(window.__mapStressReport)');
      window.__mapStressReport = report;
    }

    if (e.key === 'C' || e.key === 'c') {
      logs = [];
      gestureCount = 0;
      fpsSamples = [];
      crashRiskLevel = 0;
      maxGestureDuration = 0;
      log('OK', 'Counters reset');
    }
  });

  log('OK', 'Controls: T=auto-test zoom, M=memory snapshot, R=full report, C=reset');
  log('OK', 'Begin testing: open map, switch 2D/3D, pan, pinch, open sheets, select destinations');

  // ── Expose helpers globally ───────────────────────────────────────────────
  window.__mapStress = {
    snapMemory,
    countBackdropFilters,
    getLogs: () => logs,
    getReport: () => ({
      totalGestures: gestureCount,
      maxGestureDuration,
      crashRiskLevel,
      avgFPS: fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : null,
      minFPS: fpsSamples.length ? Math.min(...fpsSamples) : null,
      logs,
    }),
    stop() {
      cancelAnimationFrame(fpsMonitorId);
      clearInterval(memSampleId);
      classObserver?.disconnect();
      mountObserver?.disconnect();
      window.fetch = origFetch;
      window.setTimeout = origSetTimeout;
      window.requestAnimationFrame = origRAF;
      log('OK', 'Stress-test instrumentation stopped');
    },
  };

  log('OK', 'Access via window.__mapStress.getReport() or window.__mapStress.stop()');
})();
