import { deviceId } from '../lib/ids';
import { isIOS, isStandalone } from '../lib/install';

/** This device, in `meta.device`. The id never changes; the name is shown in the GitHub history and can be edited. */
export interface DeviceInfo {
  id: string;
  createdAt: number;
  name: string;
}

export function newDevice(now = Date.now()): DeviceInfo {
  return { id: deviceId(), createdAt: now, name: defaultDeviceName() };
}

/** "iPhone", "iPhone (Safari)", "iPad", "Mac (Safari)", "Mac (Chrome)". */
export function defaultDeviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  if (isIOS()) {
    const kind = /iPhone|iPod/.test(ua) ? 'iPhone' : 'iPad';
    // The Home Screen app and Safari keep separate data, so they sync as separate devices.
    return isStandalone() ? kind : `${kind} (${browser || 'Safari'})`;
  }
  const os = /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Linux|CrOS/.test(ua) ? 'Linux' : '';
  if (!os) return 'This browser';
  if (isStandalone() || !browser) return os;
  return `${os} (${browser})`;
}
