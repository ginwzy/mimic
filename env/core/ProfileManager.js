/**
 * @env-module ProfileManager
 * @description 指纹配置管理器 - 加载 profile 并注入到全局，提供运行时可调接口
 * @version 1.0.0
 */

(function() {
    'use strict';

    const profile = window.__profile__ || {};

    const ProfileManager = {
        _profile: profile,

        getSection: function(section) {
            return this._profile[section] || null;
        },

        get: function(path, fallback) {
            const parts = path.split('.');
            let current = this._profile;
            for (let i = 0; i < parts.length; i++) {
                if (current === undefined || current === null) return fallback;
                current = current[parts[i]];
            }
            return current !== undefined ? current : fallback;
        },

        set: function(path, value) {
            const parts = path.split('.');
            let current = this._profile;
            for (let i = 0; i < parts.length - 1; i++) {
                if (current[parts[i]] === undefined || current[parts[i]] === null) {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = value;
        },

        merge: function(section, data) {
            if (!this._profile[section]) {
                this._profile[section] = {};
            }
            Object.assign(this._profile[section], data);
        },

        hasProfile: function() {
            return Object.keys(this._profile).length > 0 && !!this._profile.meta;
        },

        getProfileName: function() {
            return this._profile.meta ? this._profile.meta.name : 'none';
        },

        toJSON: function() {
            return JSON.parse(JSON.stringify(this._profile));
        }
    };

    window.__ProfileManager__ = ProfileManager;
    window.__profile__ = profile;
})();
