import type { Bind, Target } from '../core/types.js';
import type { DraftOp } from '../shape/types.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';

export const STORAGE_QUOTA = 10_737_418_240;

// M2012K11AC Chrome 152 captures; do not extrapolate this surface to other targets.
export function hasAndroidChromeCapabilities(target: Target): boolean {
  return target.host === 'chrome' && target.platform === 'android' && target.version === 152;
}

export const ANDROID_CHROME_NAVIGATOR_ORDER = [
  'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling', 'userActivation',
  'geolocation', 'doNotTrack', 'webkitTemporaryStorage', 'webkitPersistentStorage',
  'windowControlsOverlay', 'hardwareConcurrency', 'cookieEnabled', 'appCodeName',
  'appName', 'appVersion', 'platform', 'product', 'userAgent', 'language', 'languages',
  'onLine', 'webdriver', 'plugins', 'mimeTypes', 'pdfViewerEnabled', 'connection',
  'getGamepads', 'javaEnabled', 'sendBeacon', 'vibrate', 'constructor', 'cpuPerformance',
  'deprecatedRunAdAuctionEnforcesKAnonymity', 'protectedAudience', 'bluetooth',
  'clipboard', 'credentials', 'keyboard', 'managed', 'mediaDevices', 'serviceWorker',
  'virtualKeyboard', 'wakeLock', 'deviceMemory', 'userAgentData', 'locks', 'storage',
  'gpu', 'contacts', 'login', 'ink', 'mediaCapabilities', 'permissions', 'devicePosture',
  'mediaSession', 'presentation', 'serial', 'usb', 'xr', 'storageBuckets',
  'adAuctionComponents', 'runAdAuction', 'canLoadAdAuctionFencedFrame', 'canShare',
  'share', 'clearAppBadge', 'getBattery', 'getUserMedia', 'requestMIDIAccess',
  'requestMediaKeySystemAccess', 'setAppBadge', 'webkitGetUserMedia',
  'clearOriginJoinedAdInterestGroups', 'createAuctionNonce', 'joinAdInterestGroup',
  'leaveAdInterestGroup', 'updateAdInterestGroups', 'deprecatedReplaceInURN',
  'deprecatedURNToURL', 'getInstalledRelatedApps', 'getInterestGroupAdAuctionData',
] as const;

interface Interface {
  name: string;
  parent?: string;
  getters?: readonly string[];
  setters?: readonly string[];
  methods?: Readonly<Record<string, number>>;
  statics?: Readonly<Record<string, number>>;
}

const INTERFACES: readonly Interface[] = [
  { name: 'Credential', getters: ['id', 'type'], statics: { isConditionalMediationAvailable: 0 } },
  { name: 'CredentialsContainer', methods: { create: 0, get: 0, preventSilentAccess: 0, store: 1 } },
  {
    name: 'PublicKeyCredential', parent: 'Credential',
    getters: ['rawId', 'response', 'authenticatorAttachment'],
    methods: { getClientExtensionResults: 0, toJSON: 0 },
    statics: {
      getClientCapabilities: 0, isConditionalMediationAvailable: 0,
      isUserVerifyingPlatformAuthenticatorAvailable: 0, parseCreationOptionsFromJSON: 1,
      parseRequestOptionsFromJSON: 1, signalAllAcceptedCredentials: 1,
      signalCurrentUserDetails: 1, signalUnknownCredential: 1,
    },
  },
  { name: 'AuthenticatorResponse', getters: ['clientDataJSON'] },
  {
    name: 'AuthenticatorAttestationResponse', parent: 'AuthenticatorResponse',
    getters: ['attestationObject'],
    methods: { getAuthenticatorData: 0, getPublicKey: 0, getPublicKeyAlgorithm: 0, getTransports: 0 },
  },
  {
    name: 'AuthenticatorAssertionResponse', parent: 'AuthenticatorResponse',
    getters: ['authenticatorData', 'signature', 'userHandle'],
  },
  { name: 'Bluetooth', parent: 'EventTarget', methods: { getAvailability: 0, requestDevice: 0 } },
  {
    name: 'MediaMetadata', getters: ['title', 'artist', 'album', 'artwork', 'chapterInfo'],
    setters: ['title', 'artist', 'album', 'artwork'],
  },
  {
    name: 'MediaSession', getters: ['metadata', 'playbackState'], setters: ['metadata', 'playbackState'],
    methods: { setActionHandler: 2, setCameraActive: 1, setMicrophoneActive: 1, setPositionState: 0 },
  },
  { name: 'ContentIndex', methods: { add: 1, delete: 1, getAll: 0 } },
];

export function capabilitySurface(target: Target): { operations: DraftOp[]; binds: Bind[] } {
  const operations: DraftOp[] = [];
  const binds: Bind[] = [];
  if (!hasAndroidChromeCapabilities(target)) return { operations, binds };
  const bind = (slot: string, type: string, member: string, action: string, length = 0): void => {
    binds.push({ slot, driver: 'nav', config: { op: 'capability', type, member, action, length, quota: STORAGE_QUOTA } });
  };
  for (const spec of INTERFACES) {
    const id = `nav.cap.${spec.name}`;
    const proto = { node: `${id}.proto` } as const;
    const parent = spec.parent && spec.parent !== 'EventTarget'
      ? { node: `nav.cap.${spec.parent}.proto` }
      : { path: `window.${spec.parent ?? 'Object'}.prototype` };
    operations.push(
      { op: 'alloc', id: proto.node, kind: 'object' },
      ctor(`${id}.ctor`, `${id}.ctor`, spec.name, proto),
      { op: 'proto', target: proto, value: parent },
      refProp({ path: 'window' }, spec.name, `${id}.ctor`),
    );
    if (spec.parent) operations.push({
      op: 'proto', target: { node: `${id}.ctor` },
      value: spec.parent === 'EventTarget' ? { path: 'window.EventTarget' } : { node: `nav.cap.${spec.parent}.ctor` },
    });
    bind(`${id}.ctor`, spec.name, 'constructor', 'construct');
    for (const name of spec.getters ?? []) {
      const get = `${id}.${name}.get`;
      const set = spec.setters?.includes(name) ? `${id}.${name}.set` : undefined;
      operations.push(fn(get, get, `get ${name}`));
      bind(get, spec.name, name, 'get');
      if (set) {
        operations.push(fn(set, set, `set ${name}`, 1));
        bind(set, spec.name, name, 'set', 1);
      }
      operations.push(accessor(proto, name, get, set));
    }
    for (const [name, length] of Object.entries(spec.methods ?? {})) {
      const slot = `${id}.${name}`;
      operations.push(fn(slot, slot, name, length), refProp(proto, name, slot, true));
      bind(slot, spec.name, name, 'method', length);
    }
    operations.push(refProp(proto, 'constructor', `${id}.ctor`), tag(proto, spec.name));
    for (const [name, length] of Object.entries(spec.statics ?? {})) {
      const slot = `${id}.static.${name}`;
      operations.push(fn(slot, slot, name, length), refProp({ node: `${id}.ctor` }, name, slot, true));
      bind(slot, spec.name, name, 'static', length);
    }
  }
  const quota = { node: 'nav.cap.DeprecatedStorageQuota.proto' } as const;
  operations.push(
    { op: 'alloc', id: quota.node, kind: 'object' },
    { op: 'proto', target: quota, value: { path: 'window.Object.prototype' } },
  );
  for (const name of ['queryUsageAndQuota', 'requestQuota']) {
    const slot = `nav.cap.DeprecatedStorageQuota.${name}`;
    operations.push(fn(slot, slot, name, 1), refProp(quota, name, slot, true));
    bind(slot, 'DeprecatedStorageQuota', name, 'method', 1);
  }
  operations.push(tag(quota, 'DeprecatedStorageQuota'));
  for (const [key, type] of Object.entries({
    credentials: 'CredentialsContainer', bluetooth: 'Bluetooth',
    webkitTemporaryStorage: 'DeprecatedStorageQuota', webkitPersistentStorage: 'DeprecatedStorageQuota',
    mediaSession: 'MediaSession',
  })) {
    const id = `nav.cap.instance.${key}`;
    const get = `${id}.get`;
    operations.push(
      { op: 'alloc', id, kind: type === 'Bluetooth' ? 'event' : 'object' },
      { op: 'proto', target: { node: id }, value: { node: `nav.cap.${type}.proto` } },
      fn(get, get, `get ${key}`),
      accessor({ path: 'window.Navigator.prototype' }, key, get),
    );
    bind(get, type, key, 'navigator');
  }
  return { operations, binds };
}
