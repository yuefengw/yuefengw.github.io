import fs from 'node:fs/promises'
import { load } from 'cheerio'

const username = 'yuefengw'
const outputPath = new URL('../source/data/github-contributions.json', import.meta.url)
const now = new Date()
const to = now.toISOString().slice(0, 10)
const fromDate = new Date(now)
fromDate.setUTCFullYear(fromDate.getUTCFullYear() - 1)
fromDate.setUTCDate(fromDate.getUTCDate() + 1)
const from = fromDate.toISOString().slice(0, 10)

const getPreviousData = async () => {
  try {
    return JSON.parse(await fs.readFile(outputPath, 'utf8'))
  } catch {
    return null
  }
}

const previous = await getPreviousData()

try {
  const url = `https://github.com/users/${username}/contributions?from=${from}&to=${to}`
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'yuefengw.github.io build bot'
    },
    signal: AbortSignal.timeout(45000)
  })

  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)

  const html = await response.text()
  const $ = load(html)
  const days = []

  $('.ContributionCalendar-day[data-date]').each((_, element) => {
    const date = $(element).attr('data-date')
    const level = Number($(element).attr('data-level') || 0)
    const id = $(element).attr('id')
    const tooltip = id ? $(`tool-tip[for="${id}"]`).text().trim() : ''
    const countMatch = tooltip.match(/([\d,]+) contributions?/) 
    days.push({
      date,
      level,
      count: countMatch ? Number(countMatch[1].replaceAll(',', '')) : 0
    })
  })

  if (days.length < 300) throw new Error(`Only found ${days.length} contribution days`)

  const end = new Date(`${to}T00:00:00Z`)
  const monthStart = new Date(end)
  monthStart.setUTCDate(monthStart.getUTCDate() - 29)
  const weekStart = new Date(end)
  weekStart.setUTCDate(weekStart.getUTCDate() - 6)
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const recentMonth = days
    .filter(day => new Date(`${day.date}T00:00:00Z`) >= monthStart)
    .reduce((sum, day) => sum + day.count, 0)
  const recentWeek = days
    .filter(day => new Date(`${day.date}T00:00:00Z`) >= weekStart)
    .reduce((sum, day) => sum + day.count, 0)

  const data = {
    username,
    generatedAt: now.toISOString(),
    range: { from, to },
    totals: { year: total, month: recentMonth, week: recentWeek },
    days
  }

  await fs.mkdir(new URL('../source/data/', import.meta.url), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`Saved ${days.length} contribution days (${total} total)`)
} catch (error) {
  if (!previous) throw error
  console.warn(`Contribution refresh failed; keeping existing data: ${error.message}`)
}
