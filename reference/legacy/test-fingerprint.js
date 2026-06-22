/**
 * 模拟真实网站指纹检测逻辑
 * 覆盖: Canvas指纹、WebGL指纹、Audio指纹、Navigator检测、Screen检测、字体检测
 */

(function() {
    var fingerprint = {};

    // ==================== 1. Navigator 基础检测 ====================
    fingerprint.navigator = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        languages: navigator.languages,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        maxTouchPoints: navigator.maxTouchPoints,
        webdriver: navigator.webdriver,
        vendor: navigator.vendor,
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        plugins: navigator.plugins ? navigator.plugins.length : 0
    };

    // ==================== 2. Screen 检测 ====================
    fingerprint.screen = {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight
    };

    // ==================== 3. Canvas 指纹 ====================
    (function() {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 50;
            var ctx = canvas.getContext('2d');

            // 典型的 canvas 指纹绘制流程
            ctx.fillStyle = 'rgb(255,0,255)';
            ctx.beginPath();
            ctx.rect(20, 20, 150, 100);
            ctx.fill();
            ctx.stroke();
            ctx.closePath();
            ctx.beginPath();
            ctx.fillStyle = 'rgb(0,255,255)';
            ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
            ctx.fill();
            ctx.closePath();

            // 文字绘制
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = 'rgb(255,5,5)';
            ctx.font = '14px Arial';
            ctx.fillText('Cwm fjordbank glyphs vext quiz, 😃', 2, 15);

            // 获取 dataURL
            var dataURL = canvas.toDataURL('image/png');

            fingerprint.canvas = {
                supported: true,
                dataURL_length: dataURL.length,
                dataURL_prefix: dataURL.substring(0, 50),
                hash: simpleHash(dataURL)
            };
        } catch (e) {
            fingerprint.canvas = { supported: false, error: e.message };
        }
    })();

    // ==================== 4. WebGL 指纹 ====================
    (function() {
        try {
            var canvas = document.createElement('canvas');
            var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

            if (!gl) {
                fingerprint.webgl = { supported: false };
                return;
            }

            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            var vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'N/A';
            var renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'N/A';

            fingerprint.webgl = {
                supported: true,
                vendor: gl.getParameter(gl.VENDOR || 7936),
                renderer: gl.getParameter(gl.RENDERER || 7937),
                version: gl.getParameter(gl.VERSION || 7938),
                unmaskedVendor: vendor,
                unmaskedRenderer: renderer,
                maxTextureSize: gl.getParameter(3379),
                extensions: gl.getSupportedExtensions().length
            };
        } catch (e) {
            fingerprint.webgl = { supported: false, error: e.message };
        }
    })();

    // ==================== 5. Audio 指纹 ====================
    (function() {
        try {
            var AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                fingerprint.audio = { supported: false };
                return;
            }

            // 创建 OfflineAudioContext 进行指纹计算
            var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            var context = new OfflineCtx(1, 44100, 44100);

            var oscillator = context.createOscillator();
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(10000, context.currentTime);

            var compressor = context.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-50, context.currentTime);
            compressor.knee.setValueAtTime(40, context.currentTime);
            compressor.ratio.setValueAtTime(12, context.currentTime);
            compressor.attack.setValueAtTime(0, context.currentTime);
            compressor.release.setValueAtTime(0.25, context.currentTime);

            oscillator.connect(compressor);
            compressor.connect(context.destination);
            oscillator.start(0);

            context.startRendering().then(function(buffer) {
                var channelData = buffer.getChannelData(0);
                var sum = 0;
                for (var i = 4500; i < 5000; i++) {
                    sum += Math.abs(channelData[i]);
                }
                fingerprint.audio = {
                    supported: true,
                    sampleRate: buffer.sampleRate,
                    sum: sum,
                    hash: simpleHash(String(sum))
                };
                outputResult();
            });
            return; // async
        } catch (e) {
            fingerprint.audio = { supported: false, error: e.message };
        }
    })();

    // ==================== 6. 时区检测 ====================
    fingerprint.timezone = {
        offset: new Date().getTimezoneOffset(),
        timezone: Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'unknown'
    };

    // ==================== 7. 存储检测 ====================
    fingerprint.storage = {
        localStorage: typeof localStorage !== 'undefined',
        sessionStorage: typeof sessionStorage !== 'undefined',
        indexedDB: typeof indexedDB !== 'undefined'
    };

    // ==================== 8. WebDriver 检测 ====================
    fingerprint.botDetection = {
        webdriver: navigator.webdriver,
        phantom: typeof window._phantom !== 'undefined' || typeof window.callPhantom !== 'undefined',
        nightmare: typeof window.__nightmare !== 'undefined',
        selenium: typeof window._selenium !== 'undefined' || typeof document.__selenium_unwrapped !== 'undefined',
        domAutomation: typeof window.domAutomation !== 'undefined' || typeof window.domAutomationController !== 'undefined'
    };

    // ==================== 辅助函数 ====================
    function simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
    }

    function outputResult() {
        console.log('');
        console.log('========== 指纹检测结果 ==========');
        console.log('');

        console.log('[Navigator]');
        console.log('  UA: ' + fingerprint.navigator.userAgent);
        console.log('  Platform: ' + fingerprint.navigator.platform);
        console.log('  Language: ' + fingerprint.navigator.language);
        console.log('  Cores: ' + fingerprint.navigator.hardwareConcurrency);
        console.log('  Memory: ' + fingerprint.navigator.deviceMemory + 'GB');
        console.log('  Plugins: ' + fingerprint.navigator.plugins);
        console.log('  WebDriver: ' + fingerprint.navigator.webdriver);
        console.log('');

        console.log('[Screen]');
        console.log('  Resolution: ' + fingerprint.screen.width + 'x' + fingerprint.screen.height);
        console.log('  ColorDepth: ' + fingerprint.screen.colorDepth);
        console.log('');

        console.log('[Canvas]');
        if (fingerprint.canvas.supported) {
            console.log('  DataURL Length: ' + fingerprint.canvas.dataURL_length);
            console.log('  Hash: ' + fingerprint.canvas.hash);
        } else {
            console.log('  Error: ' + fingerprint.canvas.error);
        }
        console.log('');

        console.log('[WebGL]');
        if (fingerprint.webgl.supported) {
            console.log('  Vendor: ' + fingerprint.webgl.vendor);
            console.log('  Renderer: ' + fingerprint.webgl.renderer);
            console.log('  Version: ' + fingerprint.webgl.version);
            console.log('  GPU Vendor: ' + fingerprint.webgl.unmaskedVendor);
            console.log('  GPU Renderer: ' + fingerprint.webgl.unmaskedRenderer);
            console.log('  MaxTextureSize: ' + fingerprint.webgl.maxTextureSize);
            console.log('  Extensions: ' + fingerprint.webgl.extensions);
        } else {
            console.log('  Not supported');
        }
        console.log('');

        console.log('[Audio]');
        if (fingerprint.audio.supported) {
            console.log('  SampleRate: ' + fingerprint.audio.sampleRate);
            console.log('  Sum: ' + fingerprint.audio.sum);
            console.log('  Hash: ' + fingerprint.audio.hash);
        } else {
            console.log('  Error: ' + (fingerprint.audio.error || 'not supported'));
        }
        console.log('');

        console.log('[Timezone]');
        console.log('  Offset: ' + fingerprint.timezone.offset);
        console.log('  Zone: ' + fingerprint.timezone.timezone);
        console.log('');

        console.log('[Bot Detection]');
        console.log('  WebDriver: ' + fingerprint.botDetection.webdriver);
        console.log('  Phantom: ' + fingerprint.botDetection.phantom);
        console.log('  Selenium: ' + fingerprint.botDetection.selenium);
        console.log('');

        console.log('[Storage]');
        console.log('  localStorage: ' + fingerprint.storage.localStorage);
        console.log('  sessionStorage: ' + fingerprint.storage.sessionStorage);
        console.log('  indexedDB: ' + fingerprint.storage.indexedDB);
        console.log('');
        console.log('===================================');

        // 检查关键值是否为空或异常
        var issues = [];
        if (!fingerprint.navigator.userAgent) issues.push('UA is empty');
        if (fingerprint.navigator.webdriver === true) issues.push('webdriver=true (will be detected as bot)');
        if (!fingerprint.webgl.supported) issues.push('WebGL not supported');
        if (fingerprint.webgl.unmaskedRenderer === 'N/A') issues.push('WebGL GPU info missing');
        if (!fingerprint.canvas.supported) issues.push('Canvas not supported');
        if (!fingerprint.audio.supported) issues.push('Audio not supported');

        if (issues.length === 0) {
            console.log('✅ 所有指纹 API 正常，未检测到异常');
        } else {
            console.log('⚠️  发现 ' + issues.length + ' 个问题:');
            issues.forEach(function(issue) {
                console.log('  - ' + issue);
            });
        }
    }

    // 如果 audio 是同步完成的（没有走 async 路径），直接输出
    if (fingerprint.audio && fingerprint.audio.supported !== undefined) {
        outputResult();
    }

    return fingerprint;
})();
