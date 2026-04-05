import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const outdir = path.join(root, 'site')
const entrypoints = ['pages/index.html', 'pages/benchmark.html']

const DEFAULT_CADENCE_ORIGIN = 'https://cadence-pretext.vercel.app'

/** Create placeholder for Vercel Analytics script (actual script provided by Vercel deployment). */
async function ensureVercelAnalyticsPlaceholder(): Promise<void> {
  const placeholderDir = path.join(root, '_vercel', 'insights')
  const placeholderPath = path.join(placeholderDir, 'script.js')
  await mkdir(placeholderDir, { recursive: true })
  await writeFile(placeholderPath, '// Vercel Analytics placeholder - actual script provided by Vercel deployment\n')
}

/** Prefer env on Vercel so canonical / Open Graph URLs match the real production host. */
function rewriteSocialOrigin(html: string): string {
  const cadenceOrigin = process.env['CADENCE_SITE_ORIGIN']?.replace(/\/$/, '')
  const vercelProd = process.env['VERCEL_PROJECT_PRODUCTION_URL']
  const fromEnv = cadenceOrigin || (vercelProd ? `https://${vercelProd}` : '')
  if (!fromEnv || fromEnv === DEFAULT_CADENCE_ORIGIN) return html
  return html.split(DEFAULT_CADENCE_ORIGIN).join(fromEnv)
}

/** Inject Vercel Web Analytics script into HTML after bundling. */
function injectVercelAnalytics(html: string): string {
  const analyticsScript = `<script defer src="/_vercel/insights/script.js"></script>`
  // Insert before closing </head> tag
  return html.replace('</head>', `  ${analyticsScript}\n</head>`)
}

await ensureVercelAnalyticsPlaceholder()

const result = Bun.spawnSync(
  ['bun', 'build', ...entrypoints, '--outdir', outdir, '--external', '/_vercel/insights/script.js'],
  {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  }
)

if (result.exitCode !== 0) {
  process.exit(result.exitCode)
}

await moveBuiltHtml('index.html', 'index.html')
await moveBuiltHtml('benchmark.html', 'benchmark.html')
await copyPagesAssetsToSite()
await rm(path.join(outdir, 'pages'), { recursive: true, force: true })

async function resolveBuiltHtmlPath(relativePath: string): Promise<string> {
  const candidates = [
    path.join(outdir, relativePath),
    path.join(outdir, 'pages', relativePath),
    path.join(outdir, 'pages', 'demos', relativePath),
    path.join(outdir, 'pages', 'benchmark', relativePath),
  ]
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!
    if (await Bun.file(candidate).exists()) return candidate
  }
  throw new Error(`Built HTML not found for ${relativePath}`)
}

async function moveBuiltHtml(sourceRelativePath: string, targetRelativePath: string): Promise<void> {
  const sourcePath = await resolveBuiltHtmlPath(sourceRelativePath)
  const targetPath = path.join(outdir, targetRelativePath)
  let html = await readFile(sourcePath, 'utf8')
  html = rebaseRelativeAssetUrls(html, sourcePath, targetPath)
  html = rewriteDemoLinksForStaticRoot(html, targetRelativePath)
  html = rewriteSocialOrigin(html)
  html = injectVercelAnalytics(html)

  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, html)
  if (sourcePath !== targetPath) await rm(sourcePath)
}

function rebaseRelativeAssetUrls(html: string, sourcePath: string, targetPath: string): string {
  return html.replace(/\b(src|href)="([^"]+)"/g, (_match, attr: string, value: string) => {
    if (!value.startsWith('.')) return `${attr}="${value}"`

    const absoluteAssetPath = path.resolve(path.dirname(sourcePath), value)
    let relativeAssetPath = path.relative(path.dirname(targetPath), absoluteAssetPath)
    relativeAssetPath = relativeAssetPath.split(path.sep).join('/')
    if (!relativeAssetPath.startsWith('.')) relativeAssetPath = `./${relativeAssetPath}`
    return `${attr}="${relativeAssetPath}"`
  })
}

function rewriteDemoLinksForStaticRoot(html: string, targetRelativePath: string): string {
  if (targetRelativePath !== 'index.html') return html
  return html.replace(/\bhref="\/demos\/([^"/]+)"/g, (_match, slug: string) => `href="./${slug}"`)
}

async function copyPagesAssetsToSite(): Promise<void> {
  const srcDir = path.join(root, 'pages', 'assets')
  const destDir = path.join(outdir, 'assets')
  const entries = await readdir(srcDir, { withFileTypes: true })
  let created = false
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (!e.isFile()) continue
    const copy =
      e.name.endsWith('.mp3') ||
      e.name === 'favicon.png' ||
      e.name === 'favicon.ico' ||
      e.name === 'og-image.jpg'
    if (!copy) continue
    if (!created) {
      await mkdir(destDir, { recursive: true })
      created = true
    }
    await copyFile(path.join(srcDir, e.name), path.join(destDir, e.name))
  }
}
