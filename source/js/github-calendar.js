(() => {
  const card = document.querySelector('.github-contribution-card')
  if (!card || card.dataset.ready === 'true') return
  card.dataset.ready = 'true'

  const scroll = card.querySelector('.github-calendar-scroll')
  const stat = name => card.querySelector(`[data-stat="${name}"]`)
  const monthsZh = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

  const renderFallback = () => {
    scroll.innerHTML = `
      <div class="calendar-fallback">
        <i class="fab fa-github" aria-hidden="true"></i>
        <span>贡献数据暂时不可用</span>
        <a href="https://github.com/yuefengw" target="_blank" rel="noopener noreferrer">前往 GitHub 查看</a>
      </div>`
  }

  const render = data => {
    if (!Array.isArray(data.days) || data.days.length === 0) throw new Error('Missing days')

    const values = new Map(data.days.map(day => [day.date, day]))
    const first = new Date(`${data.days[0].date}T00:00:00Z`)
    const last = new Date(`${data.days[data.days.length - 1].date}T00:00:00Z`)
    const gridStart = new Date(first)
    gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay())
    const weeks = []
    let cursor = new Date(gridStart)

    while (cursor <= last) {
      const week = []
      for (let index = 0; index < 7; index += 1) {
        const date = cursor.toISOString().slice(0, 10)
        week.push(values.get(date) || { date, level: -1, count: 0 })
        cursor.setUTCDate(cursor.getUTCDate() + 1)
      }
      weeks.push(week)
    }

    const monthLabels = []
    let previousMonth = -1
    weeks.forEach((week, index) => {
      const representative = new Date(`${week[3].date}T00:00:00Z`)
      const month = representative.getUTCMonth()
      if (month !== previousMonth) {
        monthLabels.push({ index, label: monthsZh[month] })
        previousMonth = month
      }
    })

    scroll.innerHTML = `
      <div class="github-calendar-visual">
        <div class="calendar-months" aria-hidden="true">
          ${monthLabels.map(item => `<span style="grid-column:${item.index + 1}">${item.label}</span>`).join('')}
        </div>
        <div class="calendar-body">
          <div class="calendar-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span></div>
          <div class="calendar-grid" role="img" aria-label="最近一年 GitHub 贡献热力图">
            ${weeks.map(week => week.map(day => {
              const hidden = day.level < 0 ? ' calendar-day-hidden' : ''
              const level = Math.max(day.level, 0)
              const label = day.count === 0 ? `${day.date} 无贡献` : `${day.date} ${day.count} 次贡献`
              return `<span class="calendar-day level-${level}${hidden}" title="${label}" aria-hidden="true"></span>`
            }).join('')).join('')}
          </div>
        </div>
        <div class="calendar-legend"><span>少</span><i class="level-0"></i><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i><span>多</span></div>
      </div>`

    stat('year').textContent = data.totals?.year ?? '--'
    stat('month').textContent = data.totals?.month ?? '--'
    stat('week').textContent = data.totals?.week ?? '--'
  }

  fetch('/data/github-contributions.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    })
    .then(render)
    .catch(renderFallback)
})()
