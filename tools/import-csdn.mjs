import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { load } from 'cheerio'
import sharp from 'sharp'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const inputPath = path.resolve(process.argv[2] || '/tmp/csdn-export.json')
const rootDir = process.cwd()
const postsDir = path.join(rootDir, 'source/_posts')
const imagesRoot = path.join(rootDir, 'source/images/csdn')

const articleConfig = {
  '159988298': { slug: 'leetcode-hot100-linked-list-binary-tree', categories: ['算法', 'LeetCode'] },
  '157477600': { slug: 'leetcode-hot100-subarray-array-matrix', categories: ['算法', 'LeetCode'] },
  '157059736': { slug: 'spring-amqp-rabbitmq-optimization', categories: ['Java', '后端工程'] },
  '157287848': { slug: 'leetcode-hot100-hash-two-pointers-sliding-window', categories: ['算法', 'LeetCode'] },
  '156642276': { slug: 'jvm-class-loading', categories: ['Java', 'JVM'] },
  '156571441': { slug: 'jvm-garbage-collection', categories: ['Java', 'JVM'] },
  '156544787': { slug: 'guava-local-cache', categories: ['Java', '后端工程'] },
  '156537650': { slug: 'jvm-memory-structure', categories: ['Java', 'JVM'] },
  '156426581': { slug: 'static-utils-vs-spring-bean', categories: ['Java', '后端工程'] },
  '156419312': { slug: 'redis-atomic-counters-async-decoupling', categories: ['Java', '后端工程'] },
  '155789816': { slug: 'linux-basic-commands', categories: ['工具与环境', 'Linux'] },
  '155300477': { slug: 'web-filter-servlet-listener-config', categories: ['Java', '后端工程'] },
  '155283249': { slug: 'layered-architecture-data-objects', categories: ['Java', '后端工程'] },
  '155277397': { slug: 'spring-global-exception-handling', categories: ['Java', '后端工程'] },
  '153075507': { slug: 'flash-sale-fine-grained-locking', categories: ['Java', '后端工程'] },
  '153072416': { slug: 'spring-transaction-self-invocation', categories: ['Java', '后端工程'] },
  '147065845': { slug: 'stm32-learning-notes', categories: ['嵌入式', 'STM32'] },
  '146170055': { slug: '51-microcontroller-notes', categories: ['嵌入式', '51 单片机'] },
  '122477734': { slug: 'leetcode-data-structure-day-5', categories: ['算法', 'LeetCode'] },
  '122471503': { slug: 'leetcode-data-structure-day-4', categories: ['算法', 'LeetCode'] },
  '122438572': { slug: 'leetcode-data-structure-day-3', categories: ['算法', 'LeetCode'] },
  '122397289': { slug: 'leetcode-data-structure-day-2', categories: ['算法', 'LeetCode'] },
  '122379281': { slug: 'leetcode-data-structure-day-1', categories: ['算法', 'LeetCode'] }
}

const tagNames = new Map([
  ['leetcode', 'LeetCode'],
  ['java', 'Java'],
  ['java-rabbitmq', 'Java'],
  ['jvm', 'JVM'],
  ['spring', 'Spring'],
  ['spring boot', 'Spring Boot'],
  ['rabbitmq', 'RabbitMQ'],
  ['redis', 'Redis'],
  ['guava', 'Guava'],
  ['linux', 'Linux'],
  ['servlet', 'Servlet'],
  ['mvc', 'Spring MVC'],
  ['c语言', 'C'],
  ['stm32', 'STM32'],
  ['bootstrap', 'Bootstrap']
])

const yamlString = value => JSON.stringify(String(value))

const cleanDescription = value => {
  const cleaned = String(value || '')
    .replace(/^文章浏览阅读[^。]*。/, '')
    .replace(/^摘要：\s*/, '')
    .replace(/_[a-zA-Z][^\s]*\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= 200) return cleaned

  const shortened = cleaned.slice(0, 200)
  const sentenceEnd = Math.max(
    shortened.lastIndexOf('。'),
    shortened.lastIndexOf('；'),
    shortened.lastIndexOf('，')
  )
  return `${shortened.slice(0, sentenceEnd >= 100 ? sentenceEnd + 1 : 200).trim()}…`
}

const normalizeTag = value => {
  const tag = String(value || '').trim().replace(/^#/, '')
  return tagNames.get(tag.toLowerCase()) || tag
}

const parseDate = (isoValue, rawValue) => {
  if (isoValue) return isoValue.replace('T', ' ').slice(0, 19)
  const match = String(rawValue || '').replaceAll('\u00a0', ' ').match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  if (!match) throw new Error(`Could not parse article date: ${rawValue}`)
  return match[0]
}

const extensionFromType = contentType => {
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('svg')) return 'svg'
  return 'webp'
}

const downloadImage = async (url, destinationBase) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 yuefengw.github.io CSDN migration' },
    signal: AbortSignal.timeout(45000)
  })
  if (!response.ok) throw new Error(`Image request failed (${response.status}): ${url}`)

  const contentType = response.headers.get('content-type') || ''
  const input = Buffer.from(await response.arrayBuffer())
  const extension = extensionFromType(contentType)
  const destination = `${destinationBase}.${extension}`

  if (extension === 'webp') {
    await sharp(input, { animated: true }).webp({ quality: 86, effort: 4 }).toFile(destination)
  } else {
    await fs.writeFile(destination, input)
  }

  return destination
}

const localizeImages = async (article, slug) => {
  const $ = load(article.html, { decodeEntities: false })
  const images = $('img[src]').toArray()
  if (images.length === 0) return { html: $.html(), cover: '/images/posts/backend-cover.webp' }

  const imageDir = path.join(imagesRoot, slug)
  await fs.mkdir(imageDir, { recursive: true })
  let firstLocalImage = null

  for (const [index, image] of images.entries()) {
    const sourceUrl = $(image).attr('src')
    const basename = String(index + 1).padStart(2, '0')
    const alt = $(image).attr('alt') || ''
    if (!alt || alt.includes('![') || alt.includes('http')) $(image).attr('alt', '文章配图')
    try {
      const destination = await downloadImage(sourceUrl, path.join(imageDir, basename))
      const publicPath = `/images/csdn/${slug}/${path.basename(destination)}`
      $(image).attr('src', publicPath)
      firstLocalImage ||= publicPath
    } catch (error) {
      console.warn(`Keeping remote image after download failure: ${error.message}`)
    }
  }

  return { html: $.html(), cover: firstLocalImage || '/images/posts/backend-cover.webp' }
}

const createTurndown = () => {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx'
  })
  service.use(gfm)
  service.addRule('cleanFencedCode', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.querySelector('code')
      const language = code?.getAttribute('class')?.match(/language-([\w+-]+)/)?.[1] || ''
      const text = (code?.textContent || node.textContent || '').trimEnd()
      return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`
    }
  })
  return service
}

const renderFrontMatter = ({ article, config, date, updated, tags, cover, description }) => [
  '---',
  `title: ${yamlString(article.title)}`,
  `slug: ${config.slug}`,
  `date: ${date}`,
  `updated: ${updated}`,
  'categories:',
  ...config.categories.map(category => `  - ${yamlString(category)}`),
  'tags:',
  ...tags.map(tag => `  - ${yamlString(tag)}`),
  `cover: ${cover}`,
  `description: ${yamlString(description)}`,
  `original_url: ${yamlString(article.sourceUrl)}`,
  'original_platform: CSDN',
  '---'
].join('\n')

const articles = JSON.parse(await fs.readFile(inputPath, 'utf8'))
if (!Array.isArray(articles) || articles.length !== Object.keys(articleConfig).length) {
  throw new Error(`Expected ${Object.keys(articleConfig).length} articles, received ${articles.length}`)
}

await fs.mkdir(postsDir, { recursive: true })
await fs.mkdir(imagesRoot, { recursive: true })

for (const article of articles) {
  const id = article.sourceUrl.match(/\/details\/(\d+)/)?.[1]
  const config = articleConfig[id]
  if (!config) throw new Error(`Missing migration configuration for ${article.sourceUrl}`)

  const date = parseDate(article.datePublished, article.rawTime)
  const updated = parseDate(article.dateModified || article.datePublished, article.rawTime)
  const description = cleanDescription(article.description)
  const tags = [...new Set([
    ...article.tags,
    ...String(article.keywords || '').split(','),
    ...config.categories.slice(1)
  ].map(normalizeTag).filter(Boolean))]

  const localized = await localizeImages(article, config.slug)
  const markdown = createTurndown().turndown(localized.html)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const notice = `> 本文最初发布于 [CSDN](${article.sourceUrl})，现迁移至本站并做格式整理。内容保留原始观点与发布时间。`
  const excerpt = description ? `${description}\n\n<!-- more -->` : '<!-- more -->'
  const frontMatter = renderFrontMatter({
    article,
    config,
    date,
    updated,
    tags,
    cover: localized.cover,
    description
  })
  const output = `${frontMatter}\n\n${excerpt}\n\n${notice}\n\n${markdown}\n`
  const outputPath = path.join(postsDir, `${config.slug}.md`)
  await fs.writeFile(outputPath, output)
  console.log(`Imported ${article.title}`)
}

console.log(`Imported ${articles.length} CSDN articles into ${postsDir}`)
