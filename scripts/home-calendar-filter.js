hexo.extend.filter.register('after_render:html', function (html, data) {
  if (data.path !== 'index.html' && data.path !== '') return html

  const calendar = `
    <section class="github-contribution-card" aria-label="GitHub 活跃度">
      <div class="github-calendar-header">
        <p class="calendar-kicker">GITHUB ACTIVITY</p>
        <a href="https://github.com/yuefengw" target="_blank" rel="noopener noreferrer" aria-label="打开王越峰的 GitHub 主页">
          <i class="fab fa-github" aria-hidden="true"></i>
          <span>@yuefengw</span>
        </a>
      </div>
      <div class="github-calendar-scroll" tabindex="0" aria-label="最近一年的 GitHub 贡献热力图">
        <div class="github-calendar-loading">正在读取 GitHub 贡献数据…</div>
      </div>
      <div class="github-calendar-summary" aria-live="polite">
        <div><span>过去一年</span><strong data-stat="year">--</strong></div>
        <div><span>最近一月</span><strong data-stat="month">--</strong></div>
        <div><span>最近一周</span><strong data-stat="week">--</strong></div>
      </div>
    </section>`

  return html.replace(
    '<div class="recent-post-items">',
    `<div class="recent-post-items">${calendar}`
  )
})
