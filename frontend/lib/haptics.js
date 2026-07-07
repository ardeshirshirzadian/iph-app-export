export function hapticLight() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}
export function hapticSuccess() {
  if ('vibrate' in navigator) navigator.vibrate([10, 50, 10]);
}
export function hapticError() {
  if ('vibrate' in navigator) navigator.vibrate([50, 30, 50, 30, 50]);
}
