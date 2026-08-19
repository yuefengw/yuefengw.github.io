import fs from 'node:fs/promises'
import path from 'node:path'
import { load } from 'cheerio'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const inputPath = path.resolve(process.argv[2] || '/tmp/wechat-export.json')
const rootDir = process.cwd()

const article = JSON.parse(await fs.readFile(inputPath, 'utf8'))
const slug = String(article.slug || 'mini-pi-agent-loop').trim()
const title = String(article.title || article.sourceTitle || '未命名文章').trim()
const description = String(article.description || '').trim()
const categories = Array.isArray(article.categories) && article.categories.length
  ? article.categories
  : ['工程实践', 'Agent 系统']
const tags = Array.isArray(article.tags) && article.tags.length
  ? article.tags
  : ['Agent', 'TypeScript', 'LLM', 'pi']
const cover = String(article.cover || '/images/posts/astraflow-cover.webp').trim()
const postPath = path.join(rootDir, `source/_posts/${slug}.md`)

const normalizeDate = value => {
  const source = String(value || '2026-07-27 22:47:00').trim()
  const chineseDate = source.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/u)
  if (chineseDate) {
    const [, year, month, day, hour, minute] = chineseDate
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute}:00`
  }
  return source.replace('T', ' ').slice(0, 19)
}

const date = normalizeDate(article.date || article.published)

const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim()

const sanitizeHtml = html => {
  const $ = load(html, { decodeEntities: false })

  $('p').each((_, element) => {
    const paragraph = $(element)
    const text = normalizeText(paragraph.text())

    if (text === 'Pi 加冕之路 · 已发布') {
      const next = paragraph.next()
      if (next.is('ol')) next.remove()
      paragraph.remove()
      return
    }

    if (
      /来自文科生.*请关注我/u.test(text)
      || /一切从简，关注我/u.test(text)
      || /留言区留言.*预约/u.test(text)
      || /关注[「『"].*AI萝卜/u.test(text)
    ) {
      paragraph.remove()
    }
  })

  $('a[href*="mp.weixin.qq.com"]').each((_, element) => {
    const link = $(element)
    link.replaceWith(link.contents())
  })
  $('img').remove()

  $('section, p').each((_, element) => {
    const node = $(element)
    if (!normalizeText(node.text()) && node.find('pre, table, blockquote').length === 0) node.remove()
  })

  return $.html()
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

const markdown = createTurndown().turndown(sanitizeHtml(article.html))
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\n关注\*\*「AI萝卜」[\s\S]*$/u, '')
  .replace(/，后续篇章会展开，一定要记得关注哦。/gu, '，后续篇章会展开。')
  .replace(/一定要记得关注哦[。！]?/gu, '')
  .replace(/^\*{0,2}来自文科生[^\n]*请关注我！?\*{0,2}$/gmu, '')
  .trim()

const frontMatter = [
  '---',
  `title: ${JSON.stringify(title)}`,
  `slug: ${slug}`,
  `date: ${date}`,
  `updated: ${date}`,
  'categories:',
  ...categories.map(category => `  - ${JSON.stringify(category)}`),
  'tags:',
  ...tags.map(tag => `  - ${JSON.stringify(tag)}`),
  `cover: ${cover}`,
  `description: ${JSON.stringify(description)}`,
  '---'
].join('\n')

await fs.writeFile(postPath, `${frontMatter}\n\n${description}\n\n<!-- more -->\n\n${markdown}\n`)
console.log(`Imported ${title} into ${postPath}`)
