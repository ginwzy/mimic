import { dataDriver } from '../engine/data.js';
import type { Driver } from '../engine/types.js';
import { capabilityDriver } from './nav.capabilities.driver.js';

// Emulated Chromium defaults, not a snapshot of any origin's saved grants or policy.
const PERMISSIONS: Readonly<Record<string, 'prompt' | 'granted' | 'denied'>> = {
  'accelerometer': 'granted',
  'ambient-light-sensor': 'prompt',
  'background-fetch': 'granted',
  'background-sync': 'granted',
  'camera': 'prompt',
  'captured-surface-control': 'prompt',
  'clipboard-read': 'prompt',
  'clipboard-write': 'granted',
  'display-capture': 'prompt',
  'fullscreen': 'prompt',
  'geolocation': 'prompt',
  'gyroscope': 'granted',
  'idle-detection': 'prompt',
  'keyboard-lock': 'prompt',
  'local-fonts': 'prompt',
  'local-network': 'prompt',
  'local-network-access': 'prompt',
  'loopback-network': 'prompt',
  'magnetometer': 'granted',
  'microphone': 'prompt',
  'midi': 'prompt',
  'nfc': 'prompt',
  'notifications': 'prompt',
  'payment-handler': 'granted',
  'periodic-background-sync': 'denied',
  'persistent-storage': 'prompt',
  'pointer-lock': 'prompt',
  'push': 'prompt',
  'screen-wake-lock': 'granted',
  'speaker-selection': 'prompt',
  'storage-access': 'granted',
  'system-wake-lock': 'prompt',
  'top-level-storage-access': 'prompt',
  'web-app-installation': 'prompt',
  'window-management': 'prompt',
};

export const navDriver: Driver = {
  open: (port) => {
    const data = dataDriver.open(port);
    const capabilities = capabilityDriver.open(port);
    const domString = port.evaluate('(value) => `${value}`') as (value: unknown) => string;
    const failure = (message: string): never => {
      throw port.error('TypeError', `Failed to execute 'query' on 'Permissions': ${message}`);
    };
    return {
      ...data,
      construct: (raw, args, newTarget) => {
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.op === 'capability') {
          return capabilities.construct?.(raw, args, newTarget);
        }
        return data.construct?.(raw, args, newTarget);
      },
      call: (raw, self, args) => {
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.op === 'capability') {
          return capabilities.call?.(raw, self, args);
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.op !== 'permissions-query') {
          return data.call?.(raw, self, args);
        }
        // WebIDL reads the descriptor synchronously but returns validation errors as rejections.
        try {
          if (self !== port.node('nav.permissions.instance')) failure('Illegal invocation');
          if (args.length === 0) failure('1 argument required, but only 0 present.');
          const descriptor = args[0];
          if (descriptor === null || (typeof descriptor !== 'object' && typeof descriptor !== 'function')) {
            return failure("parameter 1 is not of type 'object'.");
          }
          const nameValue = Reflect.get(descriptor, 'name');
          if (nameValue === undefined) failure("Failed to read the 'name' property from 'PermissionDescriptor': Required member is undefined.");
          const name = domString(nameValue);
          if (!Object.hasOwn(PERMISSIONS, name)) {
            failure(`Failed to read the 'name' property from 'PermissionDescriptor': The provided value '${name}' is not a valid enum value of type PermissionName.`);
          }
          if (name === 'ambient-light-sensor') failure('GenericSensorExtraClasses flag is not enabled.');
          if (name === 'system-wake-lock') failure('System Wake Lock is not enabled.');
          if (name === 'web-app-installation') failure('The Web App Install API is not enabled.');
          if (raw.android) {
            if (name === 'local-fonts') failure('Local Fonts Access API is not enabled.');
            if (name === 'captured-surface-control') failure('The Captured Surface Control API is not enabled.');
            if (name === 'speaker-selection') failure('The Speaker Selection API is not enabled.');
            if (name === 'keyboard-lock') failure("The Keyboard Lock permission isn't available on this platform.");
            if (name === 'pointer-lock') failure("The Pointer Lock permission isn't available on this platform.");
          }
          if (name === 'push' && !Reflect.get(descriptor, 'userVisibleOnly')) {
            throw port.evaluate(`new DOMException("Failed to execute 'query' on 'Permissions': Push Permission without userVisibleOnly:true isn't supported yet.", 'NotSupportedError')`);
          }
          if (name === 'fullscreen' && !Reflect.get(descriptor, 'allowWithoutGesture')) {
            failure('Fullscreen Permission only supports allowWithoutGesture:true.');
          }
          if (name === 'top-level-storage-access') {
            const requestedOrigin = domString(Reflect.get(descriptor, 'requestedOrigin'));
            let origin: URL | undefined;
            try { origin = new URL(requestedOrigin); } catch { /* Missing or opaque origins are not valid requests. */ }
            if (!origin || origin.origin === 'null') failure('The requested origin is invalid.');
          }
          let state = PERMISSIONS[name]!;
          if (raw.android && (name === 'window-management' || name === 'fullscreen')) state = 'denied';
          if (name === 'clipboard-write' && Reflect.get(descriptor, 'allowWithoutGesture')) state = 'prompt';
          return port.resolve({ state, onchange: null });
        } catch (error) {
          return port.resolve().then(() => { throw error; });
        }
      },
    };
  },
};
