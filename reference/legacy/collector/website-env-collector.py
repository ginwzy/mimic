#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
网站环境采集器 - 深度采集
采集指定网站的 location、navigator、document 等大对象

用法:
    python website-env-collector.py --url https://example.com
    python website-env-collector.py --url https://example.com --output env.js --format js
"""

import json
import argparse
from pathlib import Path

try:
    from DrissionPage import ChromiumPage, ChromiumOptions
except ImportError:
    print("❌ 请先安装 DrissionPage: pip install DrissionPage")
    exit(1)


def collect_website_environment(url, headless=False):
    """深度采集网站环境"""
    
    print(f"🚀 启动浏览器并访问: {url}")
    
    # 配置浏览器
    co = ChromiumOptions()
    if headless:
        co.headless()
    
    page = ChromiumPage(co)
    
    try:
        # 访问页面
        page.get(url)
        
        # 等待页面加载
        import time
        time.sleep(2)
        
        print("🔍 采集网站环境...")
        
        # 深度采集脚本
        collect_script = """
        return {
            // ========== Location 对象 ==========
            location: {
                href: location.href,
                protocol: location.protocol,
                host: location.host,
                hostname: location.hostname,
                port: location.port,
                pathname: location.pathname,
                search: location.search,
                hash: location.hash,
                origin: location.origin
            },
            
            // ========== Navigator 对象（完整） ==========
            navigator: {
                userAgent: navigator.userAgent,
                vendor: navigator.vendor,
                vendorSub: navigator.vendorSub,
                platform: navigator.platform,
                language: navigator.language,
                languages: Array.from(navigator.languages || []),
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: navigator.deviceMemory,
                maxTouchPoints: navigator.maxTouchPoints,
                webdriver: navigator.webdriver,
                cookieEnabled: navigator.cookieEnabled,
                doNotTrack: navigator.doNotTrack,
                appCodeName: navigator.appCodeName,
                appName: navigator.appName,
                appVersion: navigator.appVersion,
                product: navigator.product,
                productSub: navigator.productSub,
                onLine: navigator.onLine,
                pdfViewerEnabled: navigator.pdfViewerEnabled,
                plugins: Array.from(navigator.plugins || []).map(p => ({
                    name: p.name,
                    description: p.description,
                    filename: p.filename,
                    length: p.length
                })),
                mimeTypes: Array.from(navigator.mimeTypes || []).map(m => ({
                    type: m.type,
                    description: m.description,
                    suffixes: m.suffixes
                }))
            },
            
            // ========== Screen 对象 ==========
            screen: {
                width: screen.width,
                height: screen.height,
                availWidth: screen.availWidth,
                availHeight: screen.availHeight,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth,
                orientation: screen.orientation ? {
                    type: screen.orientation.type,
                    angle: screen.orientation.angle
                } : null
            },
            
            // ========== Window 对象 ==========
            window: {
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                outerWidth: window.outerWidth,
                outerHeight: window.outerHeight,
                devicePixelRatio: window.devicePixelRatio,
                screenX: window.screenX,
                screenY: window.screenY,
                screenLeft: window.screenLeft,
                screenTop: window.screenTop,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
                name: window.name,
                closed: window.closed,
                isSecureContext: window.isSecureContext
            },
            
            // ========== Document 对象 ==========
            document: {
                URL: document.URL,
                documentURI: document.documentURI,
                domain: document.domain,
                referrer: document.referrer,
                title: document.title,
                characterSet: document.characterSet,
                charset: document.charset,
                contentType: document.contentType,
                readyState: document.readyState,
                hidden: document.hidden,
                visibilityState: document.visibilityState,
                cookie: document.cookie
            },
            
            // ========== 时区信息 ==========
            timezone: {
                offset: new Date().getTimezoneOffset(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                locale: Intl.DateTimeFormat().resolvedOptions().locale
            },
            
            // ========== Performance ==========
            performance: {
                timeOrigin: performance.timeOrigin,
                timing: {
                    navigationStart: performance.timing.navigationStart,
                    loadEventEnd: performance.timing.loadEventEnd,
                    domComplete: performance.timing.domComplete
                }
            },
            
            // ========== WebGL 指纹 ==========
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
                        unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
                        extensions: gl.getSupportedExtensions()
                    };
                } catch (e) {
                    return { error: e.message };
                }
            })(),
            
            // ========== Canvas 指纹 ==========
            canvas: (() => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 200;
                    canvas.height = 50;
                    const ctx = canvas.getContext('2d');
                    ctx.textBaseline = 'top';
                    ctx.font = '14px Arial';
                    ctx.fillStyle = '#f60';
                    ctx.fillRect(125, 1, 62, 20);
                    ctx.fillStyle = '#069';
                    ctx.fillText('Hello, World! 你好', 2, 15);
                    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
                    ctx.fillText('Hello, World! 你好', 4, 17);
                    return canvas.toDataURL();
                } catch (e) {
                    return { error: e.message };
                }
            })(),
            
            // ========== Audio 指纹 ==========
            audio: (() => {
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (!AudioContext) return null;
                    const context = new AudioContext();
                    return {
                        sampleRate: context.sampleRate,
                        state: context.state,
                        maxChannelCount: context.destination.maxChannelCount,
                        numberOfInputs: context.destination.numberOfInputs,
                        numberOfOutputs: context.destination.numberOfOutputs,
                        channelCount: context.destination.channelCount
                    };
                } catch (e) {
                    return { error: e.message };
                }
            })(),
            
            // ========== 特征检测 ==========
            features: {
                localStorage: typeof localStorage !== 'undefined',
                sessionStorage: typeof sessionStorage !== 'undefined',
                indexedDB: typeof indexedDB !== 'undefined',
                webWorker: typeof Worker !== 'undefined',
                serviceWorker: 'serviceWorker' in navigator,
                webRTC: typeof RTCPeerConnection !== 'undefined' || typeof webkitRTCPeerConnection !== 'undefined',
                webSocket: typeof WebSocket !== 'undefined',
                geolocation: 'geolocation' in navigator,
                notification: 'Notification' in window,
                permissions: 'permissions' in navigator,
                bluetooth: 'bluetooth' in navigator,
                usb: 'usb' in navigator,
                credentials: 'credentials' in navigator
            },
            
            // ========== Cookies ==========
            cookies: document.cookie
        };
        """
        
        # 执行采集
        env_data = page.run_js(collect_script)
        
        print("✅ 环境采集完成！")
        return env_data
        
    finally:
        page.quit()
        print("🔚 浏览器已关闭")


def generate_js_code(env_data, url):
    """生成 JS 环境代码"""
    
    code = f'''/**
 * 网站环境代码 - 自动采集生成
 * 来源: {url}
 * 生成时间: {import_datetime()}
 */

(function() {{
    // ========== Location 对象 ==========
    const location = {json.dumps(env_data['location'], indent=4, ensure_ascii=False)};
    
    // ========== Navigator 对象 ==========
    const navigator = {json.dumps(env_data['navigator'], indent=4, ensure_ascii=False)};
    
    // ========== Screen 对象 ==========
    const screen = {json.dumps(env_data['screen'], indent=4, ensure_ascii=False)};
    
    // ========== Document 对象（部分属性） ==========
    const documentProps = {json.dumps(env_data['document'], indent=4, ensure_ascii=False)};
    
    // 注入到 window
    Object.assign(window, {{
        location: location,
        navigator: navigator,
        screen: screen
    }});
    
    // 创建基础 document 对象
    if (typeof document === 'undefined') {{
        window.document = {{}};
    }}
    Object.assign(document, documentProps);
    
    console.log('[WebEnv] 网站环境已加载:', '{url}');
}})();
'''
    
    return code


def import_datetime():
    from datetime import datetime
    return datetime.now().isoformat()


def main():
    parser = argparse.ArgumentParser(description='网站环境深度采集器')
    parser.add_argument('--url', required=True, help='要采集的网站URL')
    parser.add_argument('--output', '-o', help='输出文件路径')
    parser.add_argument('--format', choices=['json', 'js'], default='json', help='输出格式')
    parser.add_argument('--headless', action='store_true', help='无头模式运行')
    parser.add_argument('--pretty', action='store_true', help='格式化输出')
    
    args = parser.parse_args()
    
    try:
        # 采集环境
        env_data = collect_website_environment(args.url, args.headless)
        
        # 输出结果
        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            if args.format == 'js':
                # 生成 JS 代码
                js_code = generate_js_code(env_data, args.url)
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(js_code)
            else:
                # 输出 JSON
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(env_data, f, indent=2 if args.pretty else None, ensure_ascii=False)
            
            print(f"\n📁 环境已保存到: {output_path}")
            print(f"📊 文件大小: {output_path.stat().st_size} bytes")
            
            if args.format == 'js':
                print(f"\n💡 使用方式:")
                print(f"   node standalone-runner.js --env {output_path} your-script.js")
        else:
            # 打印到控制台
            print("\n" + "="*60)
            print("采集到的环境:")
            print("="*60)
            print(json.dumps(env_data, indent=2, ensure_ascii=False))
        
        return 0
        
    except KeyboardInterrupt:
        print("\n\n⚠️  用户中断")
        return 130
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())
