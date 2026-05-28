/**
 * @env-module screen
 * @description 浏览器screen对象模拟 - 支持 Profile 配置
 * @compatibility Chrome 80+, Firefox 75+, Edge 79+
 * @version 2.0.0
 */

(function() {
    'use strict';

    const profile = (window.__profile__ && window.__profile__.screen) || {};

    const screen = {
        width: profile.width || 1920,
        height: profile.height || 1080,
        availWidth: profile.availWidth || 1920,
        availHeight: profile.availHeight || 1040,
        availLeft: profile.availLeft !== undefined ? profile.availLeft : 0,
        availTop: profile.availTop !== undefined ? profile.availTop : 0,
        colorDepth: profile.colorDepth || 24,
        pixelDepth: profile.pixelDepth || 24,
        isExtended: profile.isExtended !== undefined ? profile.isExtended : false,

        orientation: {
            angle: (profile.orientation && profile.orientation.angle) || 0,
            type: (profile.orientation && profile.orientation.type) || 'landscape-primary',
            onchange: null,
            lock: function(orientation) { return Promise.resolve(); },
            unlock: function() {},
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
        }
    };

    window.screen = screen;
})();
