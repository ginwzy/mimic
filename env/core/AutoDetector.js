/**
 * @env-module AutoDetector
 * @description 自动检测缺失 API - 捕获 undefined 访问和运行时错误，生成报告
 * @version 1.0.0
 */

(function() {
    'use strict';

    var missingAPIs = [];
    var errors = [];
    var seen = {};

    var AutoDetector = {
        enable: function() {
            // 拦截 undefined 属性访问（配合 EnvMonitor）
            var monitor = window.__EnvMonitor__;
            if (monitor && monitor.logUndefined) {
                var original = monitor.logUndefined.bind(monitor);
                monitor.logUndefined = function(path, context, parentPath) {
                    if (!seen[path]) {
                        seen[path] = true;
                        missingAPIs.push({
                            path: path,
                            context: context || null,
                            parentPath: parentPath || null,
                            timestamp: Date.now()
                        });
                    }
                    return original(path, context, parentPath);
                };
            }
        },

        captureError: function(error) {
            var msg = (error && error.message) || String(error);
            var missingAPI = null;
            var category = 'unknown';

            // "X is not defined"
            var notDefined = msg.match(/(\w+) is not defined/);
            if (notDefined) {
                missingAPI = notDefined[1];
                category = 'not_defined';
            }

            // "Cannot read properties of undefined (reading 'X')"
            var cannotRead = msg.match(/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)/);
            if (cannotRead) {
                missingAPI = cannotRead[1];
                category = 'property_of_undefined';
            }

            // "X is not a function"
            var notFunction = msg.match(/([^\s]+) is not a function/);
            if (notFunction) {
                missingAPI = notFunction[1];
                category = 'not_a_function';
            }

            // "X is not a constructor"
            var notConstructor = msg.match(/([^\s]+) is not a constructor/);
            if (notConstructor) {
                missingAPI = notConstructor[1];
                category = 'not_a_constructor';
            }

            errors.push({
                message: msg,
                missingAPI: missingAPI,
                category: category,
                stack: error && error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null,
                timestamp: Date.now()
            });
        },

        getReport: function() {
            var criticalAPIs = [];
            for (var i = 0; i < errors.length; i++) {
                if (errors[i].missingAPI && criticalAPIs.indexOf(errors[i].missingAPI) === -1) {
                    criticalAPIs.push(errors[i].missingAPI);
                }
            }

            return {
                summary: {
                    totalMissing: missingAPIs.length,
                    totalErrors: errors.length,
                    criticalAPIs: criticalAPIs
                },
                missingAPIs: missingAPIs,
                errors: errors,
                suggestions: this._generateSuggestions()
            };
        },

        _generateSuggestions: function() {
            var suggestions = [];
            var allPaths = [];
            for (var i = 0; i < missingAPIs.length; i++) allPaths.push(missingAPIs[i].path);
            for (var i = 0; i < errors.length; i++) {
                if (errors[i].missingAPI) allPaths.push(errors[i].missingAPI);
            }
            var joined = allPaths.join(' ');

            if (/AudioContext|webkitAudioContext|OfflineAudioContext|createOscillator|createDynamicsCompressor/.test(joined)) {
                suggestions.push({ module: 'env/webapi/audio.js', reason: 'Script uses Web Audio API' });
            }
            if (/canvas|getContext|toDataURL|toBlob|CanvasRenderingContext2D/.test(joined)) {
                suggestions.push({ module: 'profile.canvas (set toDataURL)', reason: 'Script uses Canvas fingerprinting' });
            }
            if (/webgl|WebGL|getParameter|getSupportedExtensions|WEBGL_debug_renderer_info/.test(joined)) {
                suggestions.push({ module: 'profile.webgl (set parameters)', reason: 'Script uses WebGL fingerprinting' });
            }
            if (/document|createElement|getElementById|querySelector|DOM/.test(joined)) {
                suggestions.push({ module: 'env/dom/document.js + env/dom/elements.js', reason: 'Script uses DOM APIs' });
            }
            if (/navigator|userAgent|platform|plugins/.test(joined)) {
                suggestions.push({ module: 'env/bom/navigator.js', reason: 'Script accesses navigator properties' });
            }
            if (/localStorage|sessionStorage/.test(joined)) {
                suggestions.push({ module: 'env/bom/storage.js', reason: 'Script uses Web Storage' });
            }
            if (/fetch|XMLHttpRequest|Request|Response/.test(joined)) {
                suggestions.push({ module: 'env/webapi/network.js', reason: 'Script makes network requests' });
            }
            if (/crypto|getRandomValues|subtle/.test(joined)) {
                suggestions.push({ module: 'env/bom/crypto.js', reason: 'Script uses Crypto API' });
            }
            if (/performance|timing|now/.test(joined)) {
                suggestions.push({ module: 'env/bom/performance.js', reason: 'Script uses Performance API' });
            }
            if (/Intl|DateTimeFormat|timezone/.test(joined)) {
                suggestions.push({ module: 'profile.timezone', reason: 'Script checks timezone/locale' });
            }

            return suggestions;
        },

        clear: function() {
            missingAPIs = [];
            errors = [];
            seen = {};
        },

        getMissing: function() {
            return missingAPIs;
        },

        getErrors: function() {
            return errors;
        }
    };

    window.__AutoDetector__ = AutoDetector;
})();
