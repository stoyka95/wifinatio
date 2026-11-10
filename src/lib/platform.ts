/** Platform of the running build. Android shares the UI with Windows but has no
 * window chrome, tray or Windows settings, and is laid out for touch. */
export const isAndroid = /Android/i.test(navigator.userAgent);
export const isMobile = isAndroid || /iPhone|iPad/i.test(navigator.userAgent);
