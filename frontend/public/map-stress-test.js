/**
 * MAP GESTURE STRESS-TEST INSTRUMENTATION (v2 — throttled, lightweight)
 * ========================================================================
 * Paste this entire script into the browser DevTools console while on /map.
 *
 * USAGE:
 *   1. Open /map in Safari DevTools or Chrome DevTools
 *   2. Paste this script in the Console tab — it stops any prior instance first
 *   3. Reproduce the crash scenario (pan, pinch, open sheets, switch 2D/3D)
 *   4. Press R to dump the full log as JSON, copy it, report back
 *
 * Keys: T=auto-test zoom  M=memory snapshot  R=full report  C=reset  S=stop
 *
 * INSTRUMENTATION PHILOSOPHY (v2 changes from v1):
 *   - No window.requestAnimationFrame replacement (it was dead code wrapping
 *     every RAF callback from React/Three.js for zero benefit)
 *   - snapMemory() (full DOM getComputedStyle scan) REMOVED from gesture
 *     start/end paths — replaced by lightweight heap-only snapshot
 *   - All RISK log messages throttled to at most once per 5 seconds
 *   - Singleton guard: auto-stops prior instance if script is re-pasted
 *   - setInterval during-gesture sampling uses heap-only (no DOM scan)
 *   - Full DOM audit only runs on: M key, canvas mount/unmount, initial load
 */

(function () {
  'use strict';

  // ── Singleton guard ───────────────────────────────────────────────────────
  if (window.__mapStress) {
    console.log('[MAP-STRESS] Stopping previous instance before reinitializing...');
    window.__mapStress.stop();
  }

  // ── Config ────────────────────────────────────────────────────────────────
  const LOG_PREFIX = '[MAP-STRESS]';
  const MAX_LOG_LINES = 2000;
  const WARN_THROTTLE_MS = 5000;   // RISK messages: at most once per 5 seconds
  const FPS_SAMPLE_INTERVAL = 1000; // FPS measured once per second (unchanged)
  const MEM_SAMPLE_MS = 2000;      // heap sampling during gesture: every 2s (was 500ms)

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
  let fpsSamples = [];

  // Throttle timestamps for RISK-level warnings
  let lastFpsWarnTime = 0;
  let lastBdWarnTime = 0;
  let lastHeapWarnTime = 0;
  let lastGestureFpsWarnTime = 0;

  // Capture originals BEFORE any replacement (only fetch and setTimeout are replaced)
  const origFetch = window.fetch;
  const origSetTimeout = window.setTimeout;
  const origRAF = window.requestAnimationFrame;  // NOT replaced — just captured for use

  // ── Log helper ────────────────────────────────────────────────────────────
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

  // ── Lightweight heap snapshot (NO DOM scan) ───────────────────────────────
  // Use this on gesture start/end and periodic sampling — it's fast.
  function snapHeap(label) {
    if (!performance.memory) {
      log('MEMORY', label + ' (heap API unavailable on this browser)');
      return {};
    }
    const info = {
      jsHeapUsedMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      jsHeapTotalMB: (performance.memory.totalJSHeapSize / 1048576).toFixed(1),
      heapPct: ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1) + '%',
    };
    const pct = parseFloat(info.heapPct);
    if (pct > 70) {
      const now2 = performance.now();
      if (now2 - lastHeapWarnTime > WARN_THROTTLE_MS) {
        lastHeapWarnTime = now2;
        crashRiskLevel = Math.max(crashRiskLevel, 2);
        log('RISK', `JS heap at ${info.heapPct} — crash risk elevated`, info);
      }
    }
    log('MEMORY', label, info);
    return info;
  }

  // ── Backdrop-filter audit (EXPENSIVE — DOM scan) ──────────────────────────
  // Only call this manually (M key), on canvas events, and at initial load.
  // NEVER call from the gesture observer or periodic timer.
  function countBackdropFilters() {
    const all = document.querySelectorAll('*');
    let count = 0, suppressed = 0, active = 0;
    const activeList = [];

    for (const el of all) {
      const style = window.getComputedStyle(el);
      const bf = style.backdropFilter || style.webkitBackdropFilter || '';
      if (bf && bf !== 'none') {
        count++;
        if (el.closest('.map-gesture-active')) {
          suppressed++;
        } else {
          active++;
          activeList.push({
            tag: el.tagName,
            classes: el.className?.toString().slice(0, 80),
            bf: bf.slice(0, 40),
          });
        }
      }
    }

    return { count, suppressed, active, activeList };
  }

  // ── Full memory snapshot (heap + DOM audit) ───────────────────────────────
  // EXPENSIVE — only use for manual snapshots and canvas events.
  function snapMemory(label) {
    const info = snapHeap(label);

    // Canvas info
    const canvases = document.querySelectorAll('canvas');
    info.canvasCount = canvases.length;
    canvases.forEach((c, i) => {
      const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          info[`canvas${i}_renderer`] = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }
        info[`canvas${i}_size`] = `${c.width}×${c.height}`;
        info[`canvas${i}_estimatedFramebufferMB`] = (c.width * c.height * 8 / 1048576).toFixed(1);
      }
    });

    // Backdrop-filter DOM scan (the expensive part)
    const bdElements = countBackdropFilters();
    info.backdropFilterElements = bdElements.count;
    info.backdropFilterActive = bdElements.active;
    info.backdropFilterSuppressed = bdElements.suppressed;

    if (bdElements.active > 0 && gestureActive) {
      const now2 = performance.now();
      if (now2 - lastBdWarnTime > WARN_THROTTLE_MS) {
        lastBdWarnTime = now2;
        crashRiskLevel = Math.max(crashRiskLevel, 3);
        log('RISK',
          `CRITICAL: ${bdElements.active} backdrop-filter elements ACTIVE during gesture!`,
          { active: bdElements.activeList }
        );
      }
    }

    return info;
  }

  // ── Gesture-active class observer ─────────────────────────────────────────
  function findPageRoot() {
    return document.querySelector('[style*="100dvh"]') ||
           document.querySelector('.flex.flex-col') ||
           document.body;
  }

  const pageRoot = findPageRoot();
  let classObserver = null;

  if (!pageRoot) {
    log('DOM', 'WARNING: Could not find pageRootRef — gesture-active monitoring disabled');
  } else {
    classObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          const hasGestureActive = m.target.classList.contains('map-gesture-active');
          if (hasGestureActive && !gestureActive) {
            gestureActive = true;
            gestureCount++;
            lastGestureStart = performance.now();
            // Lightweight: heap only, NO DOM scan here
            log('GESTURE', `Gesture ${gestureCount} START — backdrop-filter suppressed`);
            snapHeap(`pre-gesture-${gestureCount}`);
          } else if (!hasGestureActive && gestureActive) {
            gestureActive = false;
            const dur = performance.now() - lastGestureStart;
            maxGestureDuration = Math.max(maxGestureDuration, dur);
            // Lightweight: heap only, NO DOM scan here
            log('GESTURE', `Gesture ${gestureCount} END — duration ${dur.toFixed(0)}ms`);
            snapHeap(`post-gesture-${gestureCount}`);
          }
        }
      }
    });
    classObserver.observe(pageRoot, { attributes: true, attributeFilter: ['class'] });
    log('DOM', 'pageRootRef found — gesture-active class observer installed', {
      element: `${pageRoot.tagName}.${[...pageRoot.classList].join('.')}`,
    });
  }

  // ── FPS monitor (uses origRAF directly — no wrapping overhead) ────────────
  function measureFPS(now) {
    frameCount++;
    const dt = now - lastFrameTime;
    if (dt >= FPS_SAMPLE_INTERVAL) {
      const fps = Math.round((frameCount / dt) * 1000);
      fpsSamples.push(fps);

      if (fps < 30 && gestureActive) {
        const now2 = performance.now();
        if (now2 - lastGestureFpsWarnTime > WARN_THROTTLE_MS) {
          lastGestureFpsWarnTime = now2;
          crashRiskLevel = Math.max(crashRiskLevel, 2);
          log('PERF', `LOW FPS during gesture: ${fps} fps — GPU under pressure`);
        }
      } else if (fps < 15) {
        // THROTTLED: at most once per 5 seconds to prevent console spam
        const now2 = performance.now();
        if (now2 - lastFpsWarnTime > WARN_THROTTLE_MS) {
          lastFpsWarnTime = now2;
          crashRiskLevel = Math.max(crashRiskLevel, 3);
          log('RISK', `CRITICAL LOW FPS: ${fps} fps — likely to crash`);
        }
      }

      frameCount = 0;
      lastFrameTime = now;
    }
    // Use origRAF directly — no wrapper/closure overhead
    fpsMonitorId = origRAF(measureFPS);
  }
  fpsMonitorId = origRAF(measureFPS);

  // ── fetch interceptor (detect in-flight requests during gestures) ─────────
  window.fetch = function (url, opts) {
    const urlStr = typeof url === 'string' ? url : url?.url || String(url);
    const isMapApi = urlStr.includes('/api/map') || urlStr.includes('/api/quest');
    if (isMapApi && gestureActive) {
      log('ROUTE', `fetch during ACTIVE gesture: ${urlStr}`, { gestureCount });
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

  // ── setTimeout interceptor (detect long-blocking callbacks) ──────────────
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
          log('RISK', `Main thread BLOCKED ${dur.toFixed(0)}ms — likely buildFloorGrids`);
        }
      }
      return result;
    };
    return origSetTimeout.call(window, wrapped, delay, ...args);
  };

  // ── DOM MutationObserver: detect canvas mount/unmount ─────────────────────
  const mountObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          if (node.tagName === 'CANVAS') {
            renderCount++;
            log('REACT', `Three.js canvas MOUNTED (render #${renderCount})`, {
              size: `${node.width}×${node.height}`,
              gestureActive,
            });
            // Full DOM scan here is OK — canvas mount is a rare event
            snapMemory(`canvas-mount-${renderCount}`);
          }
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
            // Full DOM scan after 200ms delay (rare event, OK to be expensive)
            origSetTimeout(() => snapMemory('canvas-unmount'), 200);
          }
        }
      }
    }
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });

  // ── Periodic heap sampling during gestures (lightweight, no DOM scan) ─────
  memSampleId = setInterval(() => {
    if (gestureActive) snapHeap('mid-gesture-sample');
  }, MEM_SAMPLE_MS);

  // ── Initial state snapshot ────────────────────────────────────────────────
  log('OK', '=== MAP STRESS TEST INSTRUMENTATION v2 ACTIVE ===');
  // Full DOM scan once at startup (page is idle, OK to be expensive)
  snapMemory('initial-state');

  const bdAudit = countBackdropFilters();
  log('DOM', 'Initial backdrop-filter audit', bdAudit);
  if (bdAudit.active > 0) {
    log('DOM', 'Active backdrop-filter elements at rest:', bdAudit.activeList);
  }

  // ── Keyboard controls ─────────────────────────────────────────────────────
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
        origSetTimeout(fireWheelCycle, 80);
      }
      fireWheelCycle();
    }

    if (e.key === 'M' || e.key === 'm') {
      // Full DOM scan on demand (M key) — explicit user request, OK to be slow
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
        recentFPS: fpsSamples.slice(-10),
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
      lastFpsWarnTime = 0;
      lastBdWarnTime = 0;
      lastHeapWarnTime = 0;
      lastGestureFpsWarnTime = 0;
      log('OK', 'Counters reset');
    }

    if (e.key === 'S' || e.key === 's') {
      window.__mapStress.stop();
      log('OK', 'Instrumentation STOPPED — re-paste script to restart');
    }
  });

  // ── Expose helpers globally ───────────────────────────────────────────────
  window.__mapStress = {
    snapMemory,     // full DOM scan — use sparingly
    snapHeap,       // lightweight heap only
    countBackdropFilters,
    getLogs: () => logs,
    getReport: () => ({
      totalGestures: gestureCount,
      maxGestureDuration,
      crashRiskLevel,
      avgFPS: fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : null,
      minFPS: fpsSamples.length ? Math.min(...fpsSamples) : null,
      recentFPS: fpsSamples.slice(-10),
      logs,
    }),
    stop() {
      cancelAnimationFrame(fpsMonitorId);
      clearInterval(memSampleId);
      classObserver?.disconnect();
      mountObserver?.disconnect();
      window.fetch = origFetch;
      window.setTimeout = origSetTimeout;
      // Note: origRAF was never replaced — nothing to restore
      log('OK', 'Stress-test instrumentation stopped');
    },
  };

  log('OK', 'Keys: T=auto-test zoom  M=memory+DOM snapshot  R=report  C=reset  S=stop');
  log('OK', 'Begin: open map, switch 2D/3D, pan, pinch, open sheets, select destinations');
  log('OK', 'If instrumentation feels slow: it is not — re-pasting re-runs the singleton guard');
})();
