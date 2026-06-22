/**
 * patch/audio —— Web Audio 指纹(OfflineAudioContext 渲染)。
 * 对照 sdenv-extend: 基于固定 seed 产出确定性音频数据。
 * TODO: 实现 OfflineAudioContext + 节点链,getChannelData 回放 profile.audio.fingerprint。
 */
export default {
  name: 'audio',
  after: [],
  apply(/* { window, profile, mask } */) {
    // stub
  },
};
