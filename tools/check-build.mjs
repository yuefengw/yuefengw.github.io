import fs from 'node:fs/promises'

const requiredFiles = [
  'public/index.html',
  'public/about/index.html',
  'public/academic/index.html',
  'public/projects/index.html',
  'public/archives/index.html',
  'public/categories/index.html',
  'public/tags/index.html',
  'public/search.json',
  'public/atom.xml',
  'public/sitemap.xml',
  'public/CNAME',
  'public/data/github-contributions.json'
]

const missing = []
for (const file of requiredFiles) {
  try {
    await fs.access(file)
  } catch {
    missing.push(file)
  }
}

if (missing.length > 0) {
  console.error(`Missing build outputs:\n${missing.join('\n')}`)
  process.exit(1)
}

const homepage = await fs.readFile('public/index.html', 'utf8')
const requiredHomepageMarkers = [
  'github-contribution-card',
  'card-info',
  'card-announcement',
  'card-recent-post',
  'card-categories',
  'card-tags',
  'card-archives',
  'card-webinfo'
]

const missingMarkers = requiredHomepageMarkers.filter(marker => !homepage.includes(marker))
if (missingMarkers.length > 0) {
  console.error(`Homepage is missing expected modules: ${missingMarkers.join(', ')}`)
  process.exit(1)
}

if (!homepage.includes('/academic/') || !homepage.includes('学术主页')) {
  console.error('Homepage navigation is missing the academic page link')
  process.exit(1)
}

const academicPage = await fs.readFile('public/academic/index.html', 'utf8')
const requiredAcademicMarkers = [
  'academic-local-nav',
  'Transfer Learning',
  'Long-Horizon Agents',
  'CASE: Cross-modal Semantic Anchoring Alignment and Structure Enhancement for Universal Domain Adaptation',
  'Text-Assisted Regression Lower Bound for Unsupervised Domain Adaptation',
  'Distilling Reliable Knowledge from VLM for Unsupervised Domain Adaptation',
  'RongCloud'
]
const missingAcademicMarkers = requiredAcademicMarkers.filter(marker => !academicPage.includes(marker))
if (missingAcademicMarkers.length > 0) {
  console.error(`Academic page is missing expected content: ${missingAcademicMarkers.join(', ')}`)
  process.exit(1)
}

const postFiles = await fs.readdir('source/_posts')
const importedPostFiles = []
for (const file of postFiles.filter(file => file.endsWith('.md'))) {
  const source = await fs.readFile(`source/_posts/${file}`, 'utf8')
  if (/^original_platform:\s*CSDN$/m.test(source)) importedPostFiles.push(file)
}
if (importedPostFiles.length !== 23) {
  console.error(`Expected 23 imported CSDN posts, found ${importedPostFiles.length}`)
  process.exit(1)
}

const missingImportedPosts = []
for (const file of importedPostFiles) {
  const source = await fs.readFile(`source/_posts/${file}`, 'utf8')
  const slug = source.match(/^slug:\s*(.+)$/m)?.[1]?.trim()
  if (!slug) {
    missingImportedPosts.push(`${file} (missing slug)`)
    continue
  }
  try {
    await fs.access(`public/posts/${slug}/index.html`)
  } catch {
    missingImportedPosts.push(slug)
  }
}

if (missingImportedPosts.length > 0) {
  console.error(`Missing imported CSDN outputs:\n${missingImportedPosts.join('\n')}`)
  process.exit(1)
}

const piArticleSlugs = [
  'mini-pi-agent-loop',
  'pi-agent-loop-production',
  'pi-steering-followup-scheduling',
  'pi-event-stream',
  'pi-sandbox-extension-part-1',
  'pi-sandbox-extension-part-2',
  'pi-harness-session-context',
  'pi-extension-system'
]

const missingPiArticles = []
const invalidPiArticles = []
for (const slug of piArticleSlugs) {
  const sourcePath = `source/_posts/${slug}.md`
  try {
    const source = await fs.readFile(sourcePath, 'utf8')
    await fs.access(`public/posts/${slug}/index.html`)
    if (/mp\.weixin\.qq\.com|公众号|AI萝卜|请关注我/u.test(source)) invalidPiArticles.push(slug)
  } catch {
    missingPiArticles.push(slug)
  }
}

if (missingPiArticles.length > 0) {
  console.error(`Missing Pi article outputs:\n${missingPiArticles.join('\n')}`)
  process.exit(1)
}

if (invalidPiArticles.length > 0) {
  console.error(`Pi articles contain source or follow prompts:\n${invalidPiArticles.join('\n')}`)
  process.exit(1)
}

const goalArticleSlugs = [
  'codex-goal-mode-1-agent-loop-contract',
  'codex-goal-mode-2-persistence-state-machine',
  'codex-goal-mode-3-runtime-continuation-budget',
  'codex-goal-mode-4-audit-failures-practice'
]

const missingGoalArticles = []
for (const slug of goalArticleSlugs) {
  try {
    const source = await fs.readFile(`source/_posts/${slug}.md`, 'utf8')
    await fs.access(`public/posts/${slug}/index.html`)
    if (!source.includes('cover: /images/posts/codex-goal-cover.webp')) {
      missingGoalArticles.push(`${slug} (missing series cover)`)
    }
  } catch {
    missingGoalArticles.push(slug)
  }
}

if (missingGoalArticles.length > 0) {
  console.error(`Missing or incomplete Codex Goal articles:\n${missingGoalArticles.join('\n')}`)
  process.exit(1)
}

await fs.access('public/images/posts/codex-goal-cover.webp')

console.log(`Build check passed: ${requiredFiles.length} files, ${requiredHomepageMarkers.length} homepage modules, ${requiredAcademicMarkers.length} academic markers, ${importedPostFiles.length} imported CSDN posts, ${piArticleSlugs.length} Pi articles, and ${goalArticleSlugs.length} Codex Goal articles verified`)
