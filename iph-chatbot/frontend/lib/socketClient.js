'use client';
import { useEffect } from 'react';
import { io } from 'socket.io-client';

let socket = null;
const refreshCallbacks = new Set();
let visibilityListenerAdded = false;

function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

function initVisibilityListener() {
  if (visibilityListenerAdded) return;
  visibilityListenerAdded = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Reconnect if the socket dropped while backgrounded
    const s = getSocket();
    if (s && !s.connected) s.connect();
    // Let each subscriber re-fetch to catch up on missed events
    for (const cb of refreshCallbacks) cb();
  });
}

// useNotificationSocket(onNewNotification, onRefresh?)
// - onNewNotification: called for each live socket event
// - onRefresh: called when app returns from background (re-fetch API to catch up)
//
// Background note: mobile browsers throttle/pause WebSocket connections when
// the tab loses focus. The visibilitychange → re-fetch on return is a reliable
// fallback. True OS-level push when fully closed requires Web Push + service
// worker + VAPID keys (a separate, larger feature).
export function useNotificationSocket(onNewNotification, onRefresh) {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on('new-notification', onNewNotification);
    return () => s.off('new-notification', onNewNotification);
  }, [onNewNotification]);

  useEffect(() => {
    if (!onRefresh) return;
    initVisibilityListener();
    refreshCallbacks.add(onRefresh);
    return () => { refreshCallbacks.delete(onRefresh); };
  }, [onRefresh]);
}
