/**
 * 编程 API 入口。
 *
 *   import { Realm, Profile } from './src/entry/index.js';
 *   const realm = await Realm.create({ profile: 'chrome-mac' });
 *   const out = realm.run('navigator.userAgent');
 *   realm.dispose();
 */
export { Realm } from '../core/realm.js';
export { Profile } from '../core/profile.js';
export { createMask } from '../mask/index.js';
export { patches } from '../patch/index.js';
