#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
浏览器指纹采集器
使用 DrissionPage 采集真实浏览器环境指纹

用法:
    python fingerprint-collector.py --url https://example.com
    python fingerprint-collector.py --url https://example.com --output env.json
"""

import json
import argparse
from pathlib import Path
try:
    from DrissionPage import ChromiumPage, ChromiumOptions
except ImportError:
    print("❌ 请先安装 DrissionPage: pip install DrissionPage")
    exit(1)

def collect_fingerprint(url='about:blank', headless=False):
    """采集浏览器指纹"""
    
    print(f"🚀 启动浏览器...")
    
    # 配置浏览器
    co = ChromiumOptions()
    if headless:
        co.headless()
    
    page = ChromiumPage(co)
    
    try:
        # 访问页面
        if url != 'about:blank':
            print(f"📄 访问页面: {url}")
            page.get(url)
        
        print("🔍 采集环境指纹...")
        
        # 采集脚本
        collect_script = """
        return {
            // Navigator 信息
            navigator: {
                userAgent: navigator.userAgent,
                vendor: navigator.vendor,
                platform: navigator.platform,
                language: navigator.language,
                languages: Array.from(navigator.languages || []),
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: navigator.deviceMemory,
                maxTouchPoints: navigator.maxTouchPoints,
                webdriver: navigator.webdriver,
                cookieEnabled: navigator.cookieEnabled,
                doNotTrack: navigator.doNotTrack,
                plugins: Array.from(navigator.plugins || []).map(p => ({
                    name: p.name,
                    description: p.description,
                    filename: p.filename
                }))
            },
            
            // Screen 信息
            screen: {
                width: screen.width,
                height: screen.height,
                availWidth: screen.availWidth,
                availHeight: screen.availHeight,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth
            },
            
            // Window 信息
            window: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                outerWidth: window.outerWidth,
                outerHeight: window.outerHeight,
                devicePixelRatio: window.devicePixelRatio,
                screenX: window.screenX,
                screenY: window.screenY
            },
            
            // Timezone
            timezone: {
                offset: new Date().getTimezoneOffset(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            
            // WebGL 信息
            webgl: (() => {
                try {
                    const canvas = document.createElement('canvas');
                    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                    if (!gl) return null;
                    
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    return {
                        vendor: gl.getParameter(gl.VENDOR),
                        renderer: gl.getParameter(gl.RENDERER),
                        version: gl.getParameter(gl.VERSION),
                        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
                        unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
                        unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null
                    };
                } catch (e) {
                    return { error: e.message };
                }
            })(),
            
            // Canvas 指纹
            canvas: (() => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    ctx.textBaseline = 'top';
                    ctx.font = '14px Arial';
                    ctx.fillText('Hello, World!', 2, 2);
                    return canvas.toDataURL().substring(0, 100) + '...';
                } catch (e) {
                    return { error: e.message };
                }
            })(),
            
            // Audio 指纹
            audio: (() => {
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (!AudioContext) return null;
                    const context = new AudioContext();
                    return {
                        sampleRate: context.sampleRate,
                        state: context.state,
                        maxChannelCount: context.destination.maxChannelCount
                    };
                } catch (e) {
                    return { error: e.message };
                }
            })(),
            
            // 特征检测
            features: {
                localStorage: typeof localStorage !== 'undefined',
                sessionStorage: typeof sessionStorage !== 'undefined',
                indexedDB: typeof indexedDB !== 'undefined',
                webWorker: typeof Worker !== 'undefined',
                serviceWorker: 'serviceWorker' in navigator,
                webRTC: typeof RTCPeerConnection !== 'undefined',
                webSocket: typeof WebSocket !== 'undefined',
                geolocation: 'geolocation' in navigator,
                notification: 'Notification' in window,
                permissions: 'permissions' in navigator
            }
        };
        """
        
        # 执行采集
        fingerprint = page.run_js(collect_script)
        
        print("✅ 指纹采集完成!")
        return fingerprint
        
    finally:
        page.quit()
        print("🔚 浏览器已关闭")


def main():
    parser = argparse.ArgumentParser(description='浏览器指纹采集器')
    parser.add_argument('--url', default='about:blank', help='要访问的URL')
    parser.add_argument('--output', '-o', help='输出文件路径 (JSON)')
    parser.add_argument('--headless', action='store_true', help='无头模式运行')
    parser.add_argument('--pretty', action='store_true', help='格式化JSON输出')
    
    args = parser.parse_args()
    
    try:
        # 采集指纹
        fingerprint = collect_fingerprint(args.url, args.headless)
        
        # 输出结果
        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(fingerprint, f, indent=2 if args.pretty else None, ensure_ascii=False)
            
            print(f"\n📁 指纹已保存到: {output_path}")
            print(f"📊 文件大小: {output_path.stat().st_size} bytes")
        else:
            # 打印到控制台
            print("\n" + "="*60)
            print("采集到的指纹:")
            print("="*60)
            print(json.dumps(fingerprint, indent=2, ensure_ascii=False))
        
        return 0
        
    except KeyboardInterrupt:
        print("\n\n⚠️ 用户中断")
        return 130
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())
