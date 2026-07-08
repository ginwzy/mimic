import { Profile } from '../../core/profile.js';

export async function profilesCommand() {
  const names = await Profile.list();
  console.log(names.length ? names.join('\n') : '(profiles/ 为空)');
}
