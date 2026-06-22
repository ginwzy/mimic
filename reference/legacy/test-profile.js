// 测试 Profile 系统
// 验证所有指纹 API 是否正确返回 profile 中的值

var results = [];

function test(name, actual, expected) {
    var pass = actual === expected;
    results.push({ name: name, pass: pass, actual: actual, expected: expected });
    if (!pass) {
        console.error('FAIL: ' + name + ' | got: ' + actual + ' | expected: ' + expected);
    }
}

function testType(name, actual, expectedType) {
    var pass = typeof actual === expectedType;
    results.push({ name: name, pass: pass, actual: typeof actual, expected: expectedType });
    if (!pass) {
        console.error('FAIL: ' + name + ' | got type: ' + typeof actual + ' | expected: ' + expectedType);
    }
}

// Navigator
test('navigator.userAgent contains Chrome/120', navigator.userAgent.includes('Chrome/120'), true);
test('navigator.platform', navigator.platform, 'Win32');
test('navigator.language', navigator.language, 'zh-CN');
test('navigator.hardwareConcurrency', navigator.hardwareConcurrency, 8);
test('navigator.deviceMemory', navigator.deviceMemory, 8);
test('navigator.webdriver', navigator.webdriver, false);
test('navigator.maxTouchPoints', navigator.maxTouchPoints, 0);
test('navigator.vendor', navigator.vendor, 'Google Inc.');
test('navigator.plugins.length', navigator.plugins.length, 5);

// Screen
test('screen.width', screen.width, 1920);
test('screen.height', screen.height, 1080);
test('screen.colorDepth', screen.colorDepth, 24);
test('screen.availHeight', screen.availHeight, 1040);

// Window
test('window.innerWidth', window.innerWidth, 1920);
test('window.innerHeight', window.innerHeight, 969);
test('window.devicePixelRatio', window.devicePixelRatio, 1);

// Location
test('location.protocol', location.protocol, 'https:');
test('location.hostname', location.hostname, 'www.example.com');

// Canvas
var canvas = document.createElement('canvas');
var ctx = canvas.getContext('2d');
testType('canvas.getContext("2d")', ctx, 'object');
var dataURL = canvas.toDataURL();
test('canvas.toDataURL starts with data:image/png', dataURL.startsWith('data:image/png;base64,iVBORw0KGgo'), true);
test('canvas.toDataURL length > 100', dataURL.length > 100, true);

// Canvas getImageData with seed
var imgData = ctx.getImageData(0, 0, 10, 10);
test('getImageData returns data', imgData.data.length, 400);
test('getImageData has non-zero data (seeded)', imgData.data[0] !== 0 || imgData.data[1] !== 0, true);

// WebGL
var glCanvas = document.createElement('canvas');
var gl = glCanvas.getContext('webgl');
testType('webgl context', gl, 'object');
test('gl.getParameter(37446) GPU renderer', gl.getParameter(37446), 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)');
test('gl.getParameter(37445) GPU vendor', gl.getParameter(37445), 'Google Inc. (NVIDIA)');
test('gl.getParameter(7938) WebGL version', gl.getParameter(7938), 'WebGL 1.0 (OpenGL ES 2.0 Chromium)');
test('gl.getParameter(3379) MAX_TEXTURE_SIZE', gl.getParameter(3379), 16384);

var exts = gl.getSupportedExtensions();
test('gl.getSupportedExtensions is array', Array.isArray(exts), true);
test('gl.getSupportedExtensions includes WEBGL_debug_renderer_info', exts.includes('WEBGL_debug_renderer_info'), true);

var debugExt = gl.getExtension('WEBGL_debug_renderer_info');
test('WEBGL_debug_renderer_info extension exists', debugExt !== null, true);
test('UNMASKED_RENDERER_WEBGL constant', debugExt.UNMASKED_RENDERER_WEBGL, 37446);

// Audio
var audioCtx = new AudioContext();
test('AudioContext.sampleRate', audioCtx.sampleRate, 44100);
test('AudioContext.state', audioCtx.state, 'suspended');
testType('AudioContext.createOscillator', audioCtx.createOscillator, 'function');
testType('AudioContext.createDynamicsCompressor', audioCtx.createDynamicsCompressor, 'function');
testType('AudioContext.createGain', audioCtx.createGain, 'function');
testType('AudioContext.createAnalyser', audioCtx.createAnalyser, 'function');

var osc = audioCtx.createOscillator();
testType('OscillatorNode.frequency', osc.frequency, 'object');
test('OscillatorNode.frequency.value', osc.frequency.value, 440);

var gain = audioCtx.createGain();
testType('GainNode.gain', gain.gain, 'object');

// OfflineAudioContext
var offlineCtx = new OfflineAudioContext(1, 44100, 44100);
testType('OfflineAudioContext.startRendering', offlineCtx.startRendering, 'function');

// ProfileManager
testType('__ProfileManager__', window.__ProfileManager__, 'object');
test('ProfileManager.hasProfile()', window.__ProfileManager__.hasProfile(), true);
test('ProfileManager.getProfileName()', window.__ProfileManager__.getProfileName(), 'chrome-120-win10-nvidia');
test('ProfileManager.get("navigator.platform")', window.__ProfileManager__.get('navigator.platform'), 'Win32');

// Summary
var passed = results.filter(function(r) { return r.pass; }).length;
var failed = results.filter(function(r) { return !r.pass; }).length;
console.log('');
console.log('=== Test Results ===');
console.log('Total: ' + results.length + ' | Passed: ' + passed + ' | Failed: ' + failed);

if (failed > 0) {
    console.log('');
    console.log('Failed tests:');
    results.filter(function(r) { return !r.pass; }).forEach(function(r) {
        console.log('  - ' + r.name + ': got ' + r.actual + ', expected ' + r.expected);
    });
}

passed + '/' + results.length + ' tests passed';
