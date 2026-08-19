(() => {
  const applyEnhancements = () => {
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
      const rel = new Set((link.getAttribute('rel') || '').split(/\s+/).filter(Boolean))
      rel.add('noopener')
      rel.add('noreferrer')
      link.setAttribute('rel', [...rel].join(' '))
    })

    const calendar = document.querySelector('.github-contribution-card')
    const aside = document.querySelector('#aside-content')
    const recentPosts = document.querySelector('#recent-posts')
    if (!calendar || !aside || !recentPosts) return

    const syncCalendarLocation = () => {
      const isMobile = window.matchMedia('(max-width: 900px)').matches
      if (isMobile && calendar.parentElement !== aside) {
        const announcement = aside.querySelector('.card-announcement')
        aside.insertBefore(calendar, announcement || aside.firstElementChild)
      } else if (!isMobile && calendar.parentElement !== recentPosts) {
        recentPosts.insertBefore(calendar, recentPosts.firstElementChild)
      }
    }

    syncCalendarLocation()
    if (!window.__wyfCalendarResizeBound) {
      window.addEventListener('resize', syncCalendarLocation, { passive: true })
      window.__wyfCalendarResizeBound = true
    }
  }

  document.addEventListener('DOMContentLoaded', applyEnhancements)
  document.addEventListener('pjax:complete', applyEnhancements)
})()
