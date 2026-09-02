import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_ROOT = path.join(ROOT, '_fp-env')

const HELP = `Usage: node generate.mjs [options]

Fetch fingerprint data from the remote server and generate env files.

Options:
  --platform <str>      Platform filter (default: android)
  --brType <str>        Browser type (default: chrome)
  --minVersion <num>    Minimum version (default: 0)
  --maxVersion <num>    Maximum version (default: 999)
  --startAfterId <num>  Start after this id (required)
  --limit <num>         Max records, 1-1000 (default: 1000)
  -h, --help            Show this help message

Example:
  node generate.mjs --startAfterId 63000 --limit 500
`

function parseOptions() {
    try {
        return parseArgs({
            options: {
                platform: { type: 'string', default: 'android' },
                brType: { type: 'string', default: 'chrome' },
                minVersion: { type: 'string', default: '0' },
                maxVersion: { type: 'string', default: '999' },
                startAfterId: { type: 'string' },
                limit: { type: 'string', default: '1000' },
                help: { type: 'boolean', short: 'h', default: false },
            },
        }).values
    } catch (error) {
        console.error(`Error: ${error.message}\n`)
        console.error(HELP)
        process.exit(1)
    }
}

const values = parseOptions()

if (values.help) {
    console.log(HELP)
    process.exit(0)
}

if (values.startAfterId === undefined) {
    console.error('Error: --startAfterId is required\n')
    console.error(HELP)
    process.exit(1)
}

const limit = Number(values.limit)
if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
    console.error('Error: --limit must be a number between 1 and 1000')
    process.exit(1)
}

const url = new URL('http://147.135.222.77:8080/fp/find')
url.searchParams.set('platform', values.platform)
url.searchParams.set('brType', values.brType)
url.searchParams.set('minVersion', values.minVersion)
url.searchParams.set('maxVersion', values.maxVersion)
url.searchParams.set('startAfterId', values.startAfterId)
url.searchParams.set('limit', String(limit))

console.log(`Fetching: ${url}`)
const res = await fetch(url)
if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`)
    process.exit(1)
}

const totalStr = res.headers.get('content-length')
const total = totalStr ? Number(totalStr) : 0
const formatBytes = (n) => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const chunks = []
let received = 0
let lastPrint = 0
const start = Date.now()
for await (const chunk of res.body) {
    chunks.push(chunk)
    received += chunk.length
    const now = Date.now()
    if (now - lastPrint > 100 || (total && received === total)) {
        lastPrint = now
        const elapsed = (now - start) / 1000
        const speed = elapsed > 0 ? received / elapsed : 0
        const pct = total ? ((received / total) * 100).toFixed(1) : '?'
        process.stdout.write(
            `\rDownloading: ${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ''} (${pct}%) @ ${formatBytes(speed)}/s`,
        )
    }
}
process.stdout.write('\n')

const responseBody = Buffer.concat(chunks)
const arr = JSON.parse(responseBody.toString('utf-8'))
if (!Array.isArray(arr)) throw new TypeError('Response must be an array')

// 按 平台_主版本 分类到子目录（windows_150 / android_133 / ...），
// 与 Rust 侧 fp_dir_for_ua 的目录命名一致；识别不了的进 unknown/
function classify(fp) {
    const hev = fp?.navigator?.userAgentData?.HighEntropyValues
    const ua = fp?.navigator?.userAgent || ''
    let platform = hev?.platform ? String(hev.platform).toLowerCase() : ''
    if (!platform) {
        if (ua.includes('Windows NT')) platform = 'windows'
        else if (ua.includes('Android')) platform = 'android'
        else if (ua.includes('Mac OS')) platform = 'macos'
        else if (ua.includes('Linux')) platform = 'linux'
    }
    const version = String(hev?.uaFullVersion || ua.match(/Chrome\/(\d+)/)?.[1] || '').split('.')[0]
    return platform && /^\d+$/.test(version) ? `${platform}_${version}` : 'unknown'
}

const records = arr.map((fpData, i) => {
    if (fpData === null || typeof fpData !== 'object' || Array.isArray(fpData)) {
        throw new TypeError(`Invalid fingerprint record at index ${i}`)
    }
    const text = fpData.text
    const id = fpData.id
    if (!Number.isSafeInteger(id) || id < 0 || typeof text !== 'string' || !/^[a-f0-9]{64}$/.test(fpData.name)) {
        throw new TypeError(`Invalid fingerprint record at index ${i}`)
    }
    const hash = createHash('sha256').update(text).digest('hex')
    if (hash !== fpData.name) throw new Error(`Fingerprint checksum mismatch: ${id}`)
    const fingerprint = JSON.parse(text)
    if (fingerprint === null || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) {
        throw new TypeError(`Fingerprint text must contain an object: ${id}`)
    }
    return { id, text, subdir: classify(fingerprint) }
})

await mkdir(OUTPUT_ROOT, { recursive: true })
await writeFile(path.join(OUTPUT_ROOT, 'response.json'), responseBody)
for (const record of records) {
    const subdir = path.join(OUTPUT_ROOT, record.subdir)
    await mkdir(subdir, { recursive: true })
    await writeFile(path.join(subdir, `z__env_${record.id}.json`), record.text)
}

console.log(`Generated ${records.length} env file(s) under ${OUTPUT_ROOT}`)
