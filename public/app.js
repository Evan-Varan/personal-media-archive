const state = {
  posts: [],
  filter: 'all',
  activePost: null,
  images: [],
  adminPosts: [],
  motionReduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  currentRoute: 'log',
}

const $ = (selector, parent = document) => parent.querySelector(selector)
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)]
const feed = $('#postFeed')
const template = $('#postTemplate')
const overlay = $('#postOverlay')
const overlayShell = $('#overlayShell')
const imageLightbox = $('#imageLightbox')
const filterName = $('#filterName')
const filterLabels = { all: 'ALL POSTS', game: 'GAMES', music: 'MUSIC' }
const routeContent = {
  log: {
    filter: 'all', label: 'ALL POSTS', system: 'MY SITE / EVERYTHING',
    title: '<span class="reveal-word">Hi! I\'m Evan,</span><br /><span class="reveal-word outline">Welcome to my</span><br /><span class="reveal-word">personal blog.</span>',
    description: 'Games, music, pictures, and whatever else<br />I feel like putting here.',
    documentTitle: 'My Site — games + music',
  },
  games: {
    filter: 'game', label: 'GAMES', system: 'MY SITE / GAMES',
    title: '<span class="reveal-word">Games</span><br /><span class="reveal-word outline">I’ve played.</span>',
    description: 'Stuff I’ve played, screenshots I liked,<br />and quick notes when I have them.',
    gatewayKicker: 'GAMES',
    gatewayTitle: 'Stuff I’ve<br />been playing.',
    gatewayCopy: 'Screenshots, good menus, and a few thoughts when I have them.',
    documentTitle: 'Games — My Site',
  },
  music: {
    filter: 'music', label: 'MUSIC', system: 'MY SITE / MUSIC',
    title: '<span class="reveal-word">Music</span><br /><span class="reveal-word outline">I’ve had on.</span>',
    description: 'Albums, songs, and whatever has been<br />stuck in my head lately.',
    gatewayKicker: 'MUSIC',
    gatewayTitle: 'Stuff I’ve<br />been listening to.',
    gatewayCopy: 'Albums, favorite tracks, and things I keep putting back on.',
    documentTitle: 'Music — My Site',
  },
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function formatDate(date) {
  const value = new Date(`${date}T12:00:00`)
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(value).toUpperCase()
}

function labelForCategory(category) {
  return category === 'game' ? 'GAME' : category === 'music' ? 'MUSIC' : 'OTHER'
}

const ratingCriteria = [
  ['replayability', 'REPLAYABILITY'], ['length', 'LENGTH'], ['story', 'STORY'],
  ['graphics', 'GRAPHICS'], ['music', 'MUSIC'], ['gameplay', 'GAMEPLAY']
]
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

function ratingAverage(ratings = {}) {
  const values = ratingCriteria.map(([key]) => Number(ratings[key])).filter((value) => Number.isFinite(value) && value >= 1 && value <= 10)
  return values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10 : null
}

function ratingSummary(ratings) {
  const overall = ratingAverage(ratings)
  return overall === null ? 'UNRATED' : `OVERALL ${overall.toFixed(1)} / 10`
}

function postMetaSummary(post) {
  if (post.category === 'game') return ratingSummary(post.ratings)
  if (post.category === 'music' && post.genre) return `GENRE / ${post.genre.toUpperCase()}`
  return ''
}

function visiblePosts() {
  return state.posts.filter((post) => state.filter === 'all' || post.category === state.filter)
}

function updateFilterUI() {
  const filters = $$('.filter')
  const index = filters.findIndex((button) => button.dataset.filter === state.filter)
  filters.forEach((button) => button.classList.toggle('is-active', button.dataset.filter === state.filter))
  const slider = $('.nav-slider')
  slider.style.transform = `translateX(${Math.max(index, 0) * 100}%)`
  slider.style.opacity = index === -1 ? '0' : '1'
  if (filterName) filterName.textContent = filterLabels[state.filter]
}

function routeFromPath() {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/games') return 'games'
  if (path === '/music') return 'music'
  return 'log'
}

function applyPublicRoute({ scrollToFeed = false } = {}) {
  const route = routeFromPath()
  const content = routeContent[route]
  state.currentRoute = route
  state.filter = content.filter
  document.body.dataset.channel = route
  document.body.dataset.page = route
  $('#heroSystemLabel').textContent = content.system
  $('#heroTitle').innerHTML = content.title
  $('#heroDescription').innerHTML = content.description
  window.requestAnimationFrame(positionSceneTargets)
  updateFilterUI()
  renderFeed()
  if (scrollToFeed) $('#feed').scrollIntoView({ behavior: state.motionReduced ? 'auto' : 'smooth', block: 'start' })
}

function navigateToRoute(path) {
  if (location.pathname === path && location.hash !== '#admin') {
    applyPublicRoute({ scrollToFeed: path !== '/' })
    return
  }
  const commit = () => {
    history.pushState({}, '', path)
    changeRoute()
    if (path !== '/') $('#feed').scrollIntoView({ behavior: state.motionReduced ? 'auto' : 'smooth', block: 'start' })
  }
  if (!state.motionReduced && document.startViewTransition) document.startViewTransition(commit)
  else {
    $('#routeTransition').classList.add('is-active')
    window.setTimeout(commit, 180)
    window.setTimeout(() => $('#routeTransition').classList.remove('is-active'), 650)
  }
}

function observeCards() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view')
        observer.unobserve(entry.target)
      }
    })
  }, { rootMargin: '0px 0px -7% 0px', threshold: 0.05 })
  $$('.post-card').forEach((card) => observer.observe(card))
}

function renderFeed() {
  const posts = visiblePosts()
  feed.innerHTML = ''
  $('#emptyState').hidden = posts.length !== 0
  $('#postCount').textContent = String(posts.length).padStart(2, '0')
  posts.forEach((post, index) => {
    const card = template.content.firstElementChild.cloneNode(true)
    card.dataset.postId = post.id
    $('.post-index', card).textContent = `${String(post.images.length).padStart(2, '0')} ${post.images.length === 1 ? 'PHOTO' : 'PHOTOS'}`
    $('.post-category', card).textContent = labelForCategory(post.category)
    const imageArea = $('.post-images', card)
    imageArea.classList.add(post.images.length === 2 ? 'multi-2' : post.images.length > 2 ? 'multi-3' : 'single')
    post.images.slice(0, 3).forEach((source, imageIndex) => {
      const image = document.createElement('img')
      image.src = source
      image.alt = post.description ? `Image ${imageIndex + 1} from ${post.description.slice(0, 65)}` : `Post image ${imageIndex + 1}`
      image.loading = index < 2 ? 'eager' : 'lazy'
      image.decoding = 'async'
      imageArea.append(image)
    })
    const albumName = post.category === 'music' ? (post.albumName || '').trim() : ''
    const artistName = post.category === 'music' ? (post.artistName || '').trim() : ''
    $('.post-album-name', card).hidden = !albumName
    $('.post-album-name', card).textContent = albumName
    $('.post-artist-name', card).hidden = !artistName
    $('.post-artist-name', card).textContent = artistName ? `ARTIST / ${artistName}` : ''
    $('.post-description', card).textContent = post.description || ' '
    $('.post-date', card).textContent = formatDate(post.postDate)
    $('.post-rating', card).textContent = postMetaSummary(post)
    const open = () => openPost(post.id, card)
    $('.post-open', card).addEventListener('click', open)
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
    })
    feed.append(card)
  })
  observeCards()
}

function makeTransition(card) {
  const source = card?.querySelector('img')
  if (!source || state.motionReduced) return
  const rect = source.getBoundingClientRect()
  const ghost = source.cloneNode(true)
  Object.assign(ghost.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: 46,
    objectFit: 'cover', borderRadius: getComputedStyle(card).borderRadius, pointerEvents: 'none', boxShadow: '0 24px 70px rgba(0,0,0,.3)'
  })
  document.body.append(ghost)
  document.documentElement.classList.add('is-diving')
  const targetWidth = Math.min(window.innerWidth * .78, 1040)
  const targetHeight = Math.min(window.innerWidth * .61, 640)
  const targetX = (window.innerWidth - targetWidth) / 2
  const targetY = Math.min(window.innerHeight * .25, 180)
  ghost.animate([
    { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: getComputedStyle(card).borderRadius, opacity: 1 },
    { left: `${targetX}px`, top: `${targetY}px`, width: `${targetWidth}px`, height: `${targetHeight}px`, borderRadius: '25px', opacity: .25 }
  ], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' }).finished.finally(() => {
    ghost.remove()
    document.documentElement.classList.remove('is-diving')
  })
}

function openPost(id, originCard) {
  const post = state.posts.find((item) => item.id === id)
  if (!post) return
  state.activePost = id
  makeTransition(originCard)
  renderOverlay(post)
  overlay.classList.add('is-open')
  overlay.setAttribute('aria-hidden', 'false')
  document.body.style.overflow = 'hidden'
  $('#overlayClose').focus({ preventScroll: true })
}

function closePost() {
  overlay.classList.remove('is-open')
  overlay.setAttribute('aria-hidden', 'true')
  document.body.style.overflow = ''
  state.activePost = null
}

function renderOverlay(post) {
  const posts = visiblePosts()
  const currentIndex = posts.findIndex((item) => item.id === post.id)
  const overall = post.category === 'game' ? ratingAverage(post.ratings) : null
  const albumName = post.category === 'music' ? (post.albumName || '').trim() : ''
  const artistName = post.category === 'music' ? (post.artistName || '').trim() : ''
  const isAlbumPost = post.category === 'music' && post.images.length === 1
  const ratingBreakdown = ratingCriteria.map(([key, label]) => `<div><span>${label}</span><strong>${Number(post.ratings?.[key]) >= 1 ? Number(post.ratings[key]).toFixed(1) : '—'}</strong></div>`).join('')
  overlayShell.innerHTML = `
    <article class="reader-post">
      <header class="reader-header">
        <div>
          <p class="reader-meta"><span>${escapeHTML(post.category === 'music' ? 'MUSIC / ALBUM' : labelForCategory(post.category))}</span>${post.category === 'music' && post.genre ? `<span>GENRE / ${escapeHTML(post.genre)}</span>` : ''}<span>${escapeHTML(formatDate(post.postDate))}</span></p>
          ${albumName ? `<p class="reader-record-label">ALBUM</p><h1 class="reader-album-name">${escapeHTML(albumName)}</h1>` : ''}
          ${artistName ? `<p class="reader-artist-name">ARTIST / ${escapeHTML(artistName)}</p>` : ''}
          ${post.description ? post.category === 'music' ? `<p class="reader-note"><span>NOTE</span>${escapeHTML(post.description)}</p>` : `<h2 class="reader-description">${escapeHTML(post.description)}</h2>` : ''}
        </div>
        <p class="reader-count">${String(post.images.length).padStart(2, '0')} ${post.images.length === 1 ? 'PHOTO' : 'PHOTOS'}</p>
      </header>
      ${overall === null ? '' : `<section class="reader-scorecard" aria-label="Post ratings"><div class="reader-overall"><span>OVERALL</span><strong>${overall.toFixed(1)}</strong><small>/ 10</small></div><div class="reader-rating-breakdown">${ratingBreakdown}</div></section>`}
      ${isAlbumPost ? `<section class="album-showcase" aria-label="Album art"><figure class="album-art"><button type="button" data-open-image="${escapeHTML(post.images[0])}" data-index="1" aria-label="View album art fullscreen"><img src="${escapeHTML(post.images[0])}" alt="${escapeHTML(albumName ? `Album art for ${albumName}` : 'Album art')}" /></button></figure></section>` : `<section class="reader-images" aria-label="Post images">${post.images.map((source, index) => `<figure class="reader-photo"><button type="button" data-open-image="${escapeHTML(source)}" data-index="${index + 1}" aria-label="View image ${index + 1} fullscreen"><img src="${escapeHTML(source)}" alt="${escapeHTML(`Post image ${index + 1}`)}" /></button></figure>`).join('')}</section>`}
      <footer class="reader-footer">
        <span></span>
        <div class="post-switcher"><button ${currentIndex === 0 ? 'disabled' : ''} data-switch="previous">← PREVIOUS</button><button ${currentIndex === posts.length - 1 ? 'disabled' : ''} data-switch="next">NEXT →</button></div>
      </footer>
    </article>`
  $('.post-switcher', overlayShell).addEventListener('click', (event) => {
    const direction = event.target.closest('button')?.dataset.switch
    if (!direction) return
    const next = posts[currentIndex + (direction === 'next' ? 1 : -1)]
    if (next) { state.activePost = next.id; renderOverlay(next) }
  })
  $$('[data-open-image]', overlayShell).forEach((button) => button.addEventListener('click', () => openLightbox(button.dataset.openImage, button.dataset.index)))
}

function openLightbox(source, index) {
  if (!source) return
  $('#lightboxImage').src = source
  $('#lightboxImage').alt = `Fullscreen post image ${index || ''}`.trim()
  $('#lightboxCaption').textContent = `IMAGE ${String(index || 1).padStart(2, '0')}`
  imageLightbox.classList.add('is-open')
  imageLightbox.setAttribute('aria-hidden', 'false')
  $('#lightboxClose').focus({ preventScroll: true })
}

function closeLightbox() {
  imageLightbox.classList.remove('is-open')
  imageLightbox.setAttribute('aria-hidden', 'true')
  $('#lightboxImage').removeAttribute('src')
}

async function api(path, options = {}) {
  const response = await fetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.')
  return data
}

async function loadPublicPosts() {
  try {
    const { posts } = await api('/api/posts')
    state.posts = posts
    renderFeed()
  } catch (error) {
    feed.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`
  }
}

function moveMagnetic(element, event) {
  const rect = element.getBoundingClientRect()
  const x = (event.clientX - rect.left - rect.width / 2) / rect.width
  const y = (event.clientY - rect.top - rect.height / 2) / rect.height
  element.style.transform = `translate(${x * 5}px, ${y * 5}px)`
}

function setupPointer() {
  const dot = $('.pointer-dot')
  const ring = $('.pointer-ring')
  const cross = $('#cursorCross')
  const trailHost = $('#cursorTrails')
  const trails = Array.from({ length: 11 }, (_, index) => {
    const trail = document.createElement('i')
    trail.style.setProperty('--trail-index', index)
    trailHost.append(trail)
    return { node: trail, x: -100, y: -100 }
  })
  let ringX = -100, ringY = -100, crossX = -100, crossY = -100, mouseX = -100, mouseY = -100
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return
    mouseX = event.clientX; mouseY = event.clientY
    dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px,0)`
    document.documentElement.style.setProperty('--cursor-x', `${(mouseX / window.innerWidth) * 100}%`)
    document.documentElement.style.setProperty('--cursor-y', `${(mouseY / window.innerHeight) * 100}%`)
  })
  const tick = () => {
    ringX += (mouseX - ringX) * .18; ringY += (mouseY - ringY) * .18
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px,0)`
    crossX += (mouseX - crossX) * .13; crossY += (mouseY - crossY) * .13
    cross.style.transform = `translate3d(${crossX}px, ${crossY}px,0)`
    if (!state.motionReduced) {
      let targetX = mouseX
      let targetY = mouseY
      trails.forEach((trail, index) => {
        const pull = .34 - index * .021
        trail.x += (targetX - trail.x) * pull
        trail.y += (targetY - trail.y) * pull
        trail.node.style.transform = `translate3d(${trail.x}px, ${trail.y}px,0)`
        trail.node.style.opacity = mouseX < 0 ? '0' : String(Math.max(.28, .88 - index * .055))
        targetX = trail.x
        targetY = trail.y
      })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest('a,button,input,textarea,select,.post-card,.upload-zone')
    document.body.classList.toggle('pointer-active', Boolean(target))
  })
  $$('.magnetic').forEach((element) => {
    element.addEventListener('pointermove', (event) => { if (!state.motionReduced) moveMagnetic(element, event) })
    element.addEventListener('pointerleave', () => { element.style.transform = '' })
  })
}

function setupSkySecrets() {
  let lastTrigger = 0
  const burst = (origin) => {
    const rect = origin.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.top + rect.height / 2
    Array.from({ length: 18 }, (_, index) => {
      const bubble = document.createElement('i')
      const angle = (Math.PI * 2 * index) / 18 + Math.random() * .25
      const distance = 55 + Math.random() * 180
      bubble.className = 'burst-bubble'
      bubble.style.left = `${startX}px`
      bubble.style.top = `${startY}px`
      bubble.style.setProperty('--burst-size', `${10 + Math.random() * 28}px`)
      bubble.style.setProperty('--burst-x', `${Math.cos(angle) * distance}px`)
      bubble.style.setProperty('--burst-y', `${Math.sin(angle) * distance - 35}px`)
      bubble.style.animationDelay = `${index * .018}s`
      document.body.append(bubble)
      window.setTimeout(() => bubble.remove(), 2300)
    })
  }

  const sparkle = (origin) => {
    const rect = origin.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.top + rect.height / 2
    Array.from({ length: 12 }, (_, index) => {
      const star = document.createElement('i')
      const angle = (Math.PI * 2 * index) / 12
      const distance = 38 + Math.random() * 100
      star.className = 'burst-spark'
      star.style.left = `${startX}px`
      star.style.top = `${startY}px`
      star.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`)
      star.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`)
      star.style.animationDelay = `${index * .025}s`
      document.body.append(star)
      window.setTimeout(() => star.remove(), 1500)
    })
  }

  const replay = (node, className, duration) => {
    node.classList.remove(className)
    void node.offsetWidth
    node.classList.add(className)
    window.setTimeout(() => node.classList.remove(className), duration)
  }

  const trigger = (button) => {
    const now = Date.now()
    if (now - lastTrigger < 350) return
    lastTrigger = now
    const scene = button.dataset.scene
    replay(button, 'is-playing', 900)
    // The response belongs to the object itself—no fixed HUD toast or dashboard control.
    if (scene === 'bubble') burst(button)
    if (scene === 'buddies' || scene === 'plane') sparkle(button)
    if (scene === 'controller' || scene === 'save-cube') sparkle(button)
    if (scene === 'drone' || scene === 'bird') sparkle(button)
    if (scene === 'speaker') burst(button)
    if (scene === 'disc') sparkle(button)
  }

  $$('.scene-item').forEach((button) => {
    button.addEventListener('pointerup', (event) => { event.preventDefault(); trigger(button) })
    button.addEventListener('click', (event) => { event.preventDefault(); trigger(button) })
  })
}

const sceneSource = { width: 1672, height: 941 }
const sceneTargets = {
  log: {
    bubble: { x: .846, y: .18, w: .09, h: .12, clip: 'circle(47%)', radius: '50%' },
    buddies: { x: .872, y: .66, w: .082, h: .105, clip: 'ellipse(42% 46% at 50% 53%)', radius: '46%' },
    plane: { x: .682, y: .102, w: .092, h: .06, clip: 'polygon(0 45%, 43% 26%, 100% 40%, 64% 56%, 28% 74%)', radius: '50%' },
  },
  games: {
    controller: { x: .69, y: .67, w: .27, h: .29, clip: 'polygon(3% 56%, 13% 27%, 32% 13%, 67% 13%, 89% 29%, 98% 58%, 88% 88%, 68% 70%, 50% 74%, 31% 70%, 12% 88%)', radius: '42%' },
    'save-cube': { x: .765, y: .56, w: .066, h: .105, clip: 'polygon(50% 0, 100% 24%, 92% 88%, 50% 100%, 8% 88%, 0 24%)', radius: '10px' },
    drone: { x: .82, y: .085, w: .145, h: .105, clip: 'polygon(0 52%, 30% 37%, 43% 7%, 57% 7%, 70% 37%, 100% 52%, 69% 60%, 56% 92%, 43% 92%, 30% 60%)', radius: '45%' },
  },
  music: {
    speaker: { x: .76, y: .69, w: .22, h: .24, clip: 'ellipse(48% 43% at 50% 52%)', radius: '48%' },
    disc: { x: .56, y: .71, w: .15, h: .13, clip: 'circle(46%)', radius: '50%' },
    bird: { x: .685, y: .055, w: .15, h: .12, clip: 'polygon(0 53%, 31% 39%, 49% 6%, 59% 7%, 71% 39%, 100% 53%, 71% 62%, 53% 93%, 42% 93%, 30% 61%)', radius: '45%' },
  },
}

function positionSceneTargets() {
  const page = document.body.dataset.page
  const targets = sceneTargets[page]
  const hero = $('#log')
  if (!targets || !hero) return

  const rect = hero.getBoundingClientRect()
  const scale = Math.max(rect.width / sceneSource.width, rect.height / sceneSource.height)
  const imageWidth = sceneSource.width * scale
  const imageHeight = sceneSource.height * scale
  const style = getComputedStyle(hero)
  const [positionX = 'center', positionY = 'center'] = style.backgroundPosition.split(/\s+/)
  const xOffset = positionX.includes('right') ? rect.width - imageWidth : positionX.includes('left') ? 0 : (rect.width - imageWidth) / 2
  const yOffset = positionY.includes('bottom') ? rect.height - imageHeight : positionY.includes('top') ? 0 : (rect.height - imageHeight) / 2

  Object.entries(targets).forEach(([scene, target]) => {
    const button = $(`.scene-item[data-scene="${scene}"]`)
    if (!button) return
    button.style.left = `${xOffset + target.x * imageWidth}px`
    button.style.top = `${yOffset + target.y * imageHeight}px`
    button.style.width = `${target.w * imageWidth}px`
    button.style.height = `${target.h * imageHeight}px`
    button.style.clipPath = target.clip
    button.style.borderRadius = target.radius
  })
}

function setupSceneTargets() {
  let frame
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(positionSceneTargets)
  }
  window.addEventListener('resize', schedule, { passive: true })
  schedule()
}

function setupScrollStudio() {
  let previousY = window.scrollY
  let scheduled = false

  const paint = () => {
    const currentY = window.scrollY
    const velocity = currentY - previousY
    previousY = currentY
    document.documentElement.style.setProperty('--scroll-velocity', `${Math.max(-14, Math.min(14, velocity))}px`)
    const scrollableHeight = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
    document.documentElement.style.setProperty('--scroll-progress', String(currentY / scrollableHeight))
    $$('.post-card').forEach((card, index) => {
      const rect = card.getBoundingClientRect()
      const distance = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight
      const direction = index % 2 ? -1 : 1
      card.style.setProperty('--scroll-drift', `${Math.max(-10, Math.min(10, distance * 9 * direction))}px`)
    })
    scheduled = false
  }

  window.addEventListener('scroll', () => {
    if (state.motionReduced || scheduled) return
    scheduled = true
    requestAnimationFrame(paint)
  }, { passive: true })
  paint()
}

function imageSource(item) {
  return item.kind === 'new' ? item.preview : item.source
}

function clearImages() {
  state.images.filter((item) => item.kind === 'new' && item.preview).forEach((item) => URL.revokeObjectURL(item.preview))
  state.images = []
}

function lookupHeader(response, name) {
  try { return decodeURIComponent(response.headers.get(name) || '') } catch { return '' }
}

async function findAlbumArt() {
  const artist = $('#artistName').value.trim()
  const album = $('#albumName').value.trim()
  const message = $('#musicLookupMessage')
  const button = $('#lookupAlbumArt')
  message.classList.remove('error')
  if (!artist || !album) {
    message.textContent = 'Add both the artist and album name first.'
    message.classList.add('error')
    return
  }
  if (state.images.length && !window.confirm('Replace the current post image(s) with the matched album art?')) return
  button.disabled = true
  message.textContent = 'SEARCHING THE COVER ARCHIVE…'
  try {
    const query = new URLSearchParams({ artist, album })
    const response = await fetch(`/api/admin/music-art?${query}`)
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'No matching album art was found.')
    }
    const blob = await response.blob()
    if (!acceptedImageTypes.has(blob.type.toLowerCase()) || !blob.size) throw new Error('The cover archive did not return a usable image.')
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[blob.type.toLowerCase()] || 'jpg'
    const file = new File([blob], `album-art.${extension}`, { type: blob.type })
    clearImages()
    state.images.push({ kind: 'new', file, preview: URL.createObjectURL(file) })
    const matchedAlbum = lookupHeader(response, 'X-Archive-Album')
    const matchedArtist = lookupHeader(response, 'X-Archive-Artist')
    const matchedGenre = lookupHeader(response, 'X-Archive-Genre')
    if (matchedAlbum) $('#albumName').value = matchedAlbum
    if (matchedArtist) $('#artistName').value = matchedArtist
    if (matchedGenre) $('#genre').value = matchedGenre
    message.textContent = 'ALBUM ART ADDED — REVIEW IT, THEN PUBLISH.'
    renderImagePreview(); updateMiniPreview()
  } catch (error) {
    message.textContent = error.message
    message.classList.add('error')
  } finally {
    button.disabled = false
  }
}

function renderImagePreview() {
  const preview = $('#imagePreview')
  preview.innerHTML = ''
  $('#imageOrderHint').hidden = state.images.length < 2
  state.images.forEach((item, index) => {
    const node = document.createElement('div')
    node.className = 'preview-thumb'
    node.draggable = true
    node.title = 'Drag to reorder'
    node.innerHTML = `<img src="${escapeHTML(imageSource(item))}" alt="${item.kind === 'new' ? 'New upload' : 'Existing'} image" /><span class="preview-index">${String(index + 1).padStart(2, '0')}</span><span class="preview-grip" aria-hidden="true">⠿</span><button type="button" class="preview-remove" data-remove aria-label="Remove image">×</button>`
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(index))
      node.classList.add('is-dragging')
    })
    node.addEventListener('dragend', () => $$('.preview-thumb', preview).forEach((thumb) => thumb.classList.remove('is-dragging', 'is-drop-target')))
    node.addEventListener('dragover', (event) => {
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      if (!node.classList.contains('is-dragging')) node.classList.add('is-drop-target')
    })
    node.addEventListener('dragleave', () => node.classList.remove('is-drop-target'))
    node.addEventListener('drop', (event) => {
      event.preventDefault()
      const sourceIndex = Number(event.dataTransfer.getData('text/plain'))
      if (!Number.isInteger(sourceIndex) || sourceIndex === index) return
      const bounds = node.getBoundingClientRect()
      const dropAfter = event.clientX > bounds.left + bounds.width / 2
      const [moved] = state.images.splice(sourceIndex, 1)
      let destination = index + (dropAfter ? 1 : 0)
      if (sourceIndex < destination) destination -= 1
      state.images.splice(destination, 0, moved)
      renderImagePreview(); updateMiniPreview()
    })
    $('[data-remove]', node).addEventListener('click', () => {
      const [removed] = state.images.splice(index, 1)
      if (removed.kind === 'new' && removed.preview) URL.revokeObjectURL(removed.preview)
      renderImagePreview(); updateMiniPreview()
    })
    preview.append(node)
  })
}

function localDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateFromValue(value) {
  if (value instanceof Date) return value
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(`${value}T12:00:00`) : new Date()
}

function setCategory(category) {
  const value = ['game', 'music', 'other'].includes(category) ? category : 'other'
  $('#category').value = value
  const hasScorecard = value === 'game'
  const hasGenre = value === 'music'
  $('#ratingsPanel').hidden = !hasScorecard
  $('#ratingsPanel').setAttribute('aria-hidden', String(!hasScorecard))
  $('#musicDetailsPanel').hidden = !hasGenre
  $('#musicDetailsPanel').setAttribute('aria-hidden', String(!hasGenre))
  $('#albumName').disabled = !hasGenre
  $('#artistName').disabled = !hasGenre
  $('#genre').disabled = !hasGenre
  $$('[data-category]', $('#categorySelect')).forEach((option) => {
    const selected = option.dataset.category === value
    option.setAttribute('aria-checked', String(selected))
    option.classList.toggle('is-selected', selected)
  })
}

function renderCalendar() {
  const grid = $('#calendarGrid')
  const selected = $('#postDate').value
  const month = state.calendarMonth || dateFromValue(selected)
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstDay = new Date(year, monthIndex, 1)
  const dayOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const today = localDateValue(new Date())
  $('#calendarMonth').textContent = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(firstDay).toUpperCase()
  grid.innerHTML = ''
  for (let index = 0; index < dayOffset; index += 1) grid.append(document.createElement('span'))
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = localDateValue(new Date(year, monthIndex, day))
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.date = value
    button.textContent = String(day)
    button.setAttribute('role', 'gridcell')
    button.setAttribute('aria-label', formatDate(value))
    button.setAttribute('aria-selected', String(value === selected))
    button.className = `${value === selected ? 'is-selected ' : ''}${value === today ? 'is-today' : ''}`.trim()
    grid.append(button)
  }
}

function setPostDate(value) {
  const date = dateFromValue(value)
  const normalized = localDateValue(date)
  $('#postDate').value = normalized
  $('#dateDay').textContent = String(date.getDate()).padStart(2, '0')
  $('#dateWeekday').textContent = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date).toUpperCase()
  $('#dateMonth').textContent = new Intl.DateTimeFormat('en', { month: 'long' }).format(date).toUpperCase()
  $('#dateYear').textContent = String(date.getFullYear())
  state.calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  renderCalendar()
}

function closeDatePicker() {
  $('#datePopover').hidden = true
  $('#dateTrigger').setAttribute('aria-expanded', 'false')
}

function currentRatings() {
  if ($('#category').value !== 'game') return {}
  return Object.fromEntries($$('.rating-control input').map((input) => [input.dataset.rating, Number(input.value)]))
}

function updateRatingPresentation() {
  $$('.rating-control').forEach((control) => {
    const input = $('input', control)
    const value = Number(input.value)
    $$('[data-rating-value]', control).forEach((option) => {
      const score = Number(option.dataset.ratingValue)
      option.classList.toggle('is-filled', score <= value)
      option.classList.toggle('is-selected', score === value)
      option.setAttribute('aria-checked', String(score === value))
    })
    $('output', control).textContent = value ? `${value.toFixed(1)} / 10` : 'NOT RATED'
  })
  const overall = ratingAverage(currentRatings())
  $('#overallRating').textContent = overall === null ? '—' : overall.toFixed(1)
}

function setRatings(ratings = {}) {
  $$('.rating-control input').forEach((input) => {
    const value = Number(ratings[input.dataset.rating])
    input.value = Number.isFinite(value) && value >= 1 && value <= 10 ? String(value) : '0'
  })
  updateRatingPresentation()
}

function setupComposerControls() {
  $$('[data-category]', $('#categorySelect')).forEach((option) => option.addEventListener('click', () => {
    setCategory(option.dataset.category)
    updateMiniPreview()
  }))
  $$('.rating-options').forEach((options) => {
    const criterion = options.dataset.ratingOptions
    for (let score = 1; score <= 10; score += 1) {
      const option = document.createElement('button')
      option.type = 'button'
      option.dataset.ratingValue = String(score)
      option.setAttribute('role', 'radio')
      option.setAttribute('aria-label', `Rate ${criterion} ${score} out of 10`)
      option.textContent = String(score)
      option.addEventListener('click', () => {
        const input = $(`[data-rating="${criterion}"]`)
        input.value = Number(input.value) === score ? '0' : String(score)
        updateRatingPresentation(); updateMiniPreview()
      })
      options.append(option)
    }
  })
  $('#dateTrigger').addEventListener('click', () => {
    const popover = $('#datePopover')
    popover.hidden = !popover.hidden
    $('#dateTrigger').setAttribute('aria-expanded', String(!popover.hidden))
  })
  $('#datePrevious').addEventListener('click', () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() - 1); renderCalendar() })
  $('#dateNext').addEventListener('click', () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() + 1); renderCalendar() })
  $('#calendarGrid').addEventListener('click', (event) => {
    const date = event.target.closest('[data-date]')?.dataset.date
    if (!date) return
    setPostDate(date)
    closeDatePicker()
    updateMiniPreview()
  })
  document.addEventListener('click', (event) => {
    if (!$('#datePicker').contains(event.target)) closeDatePicker()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    closeDatePicker()
  })
  setCategory($('#category').value)
  setPostDate(new Date())
  setRatings()
}

function updateMiniPreview() {
  const description = $('#description').value.trim()
  const category = $('#category').value
  const postDate = $('#postDate').value || localDateValue(new Date())
  $('#previewCategory').textContent = `${labelForCategory(category)} / ${formatDate(postDate)}`
  $('#previewText').textContent = description || 'Your short note goes here.'
  const hasScorecard = category === 'game'
  const hasGenre = category === 'music'
  const genre = $('#genre').value.trim()
  const albumName = $('#albumName').value.trim()
  const artistName = $('#artistName').value.trim()
  $('#previewRating').hidden = !hasScorecard && !hasGenre
  $('#previewRating').textContent = hasScorecard ? ratingSummary(currentRatings()) : hasGenre ? `ARTIST / ${artistName || '—'}${genre ? ` · ${genre.toUpperCase()}` : ''}` : ''
  $('#previewText').textContent = hasGenre && albumName ? albumName : description || 'Your short note goes here.'
  const firstImage = state.images[0] ? imageSource(state.images[0]) : ''
  $('.mini-image').style.backgroundImage = firstImage ? `linear-gradient(135deg,rgba(8,105,139,.12),rgba(223,255,197,.1)),url("${firstImage}")` : ''
  $('.mini-image').style.backgroundSize = 'cover'
  $('.mini-image').style.backgroundPosition = 'center'
}

function resetComposer() {
  $('#postForm').reset()
  setCategory('game')
  setPostDate(new Date())
  setRatings()
  $('#published').checked = true
  $('#editingId').value = ''
  clearImages()
  $('#composerMode').textContent = 'NEW POST'
  $('#cancelEdit').hidden = true
  $('#savePost').innerHTML = 'PUBLISH <span>→</span>'
  $('#postMessage').textContent = ''
  renderImagePreview(); updateMiniPreview()
}

function editPost(id) {
  const post = state.adminPosts.find((item) => item.id === id)
  if (!post) return
  $('#editingId').value = post.id
  $('#description').value = post.description
  $('#albumName').value = post.albumName || ''
  $('#artistName').value = post.artistName || ''
  $('#genre').value = post.genre || ''
  setCategory(post.category)
  setPostDate(post.postDate)
  setRatings(post.ratings)
  $('#published').checked = post.published
  clearImages()
  state.images = post.images.map((source) => ({ kind: 'existing', source }))
  $('#composerMode').textContent = `EDITING / ${formatDate(post.postDate)}`
  $('#cancelEdit').hidden = false
  $('#savePost').innerHTML = 'SAVE CHANGES <span>→</span>'
  renderImagePreview(); updateMiniPreview()
  $('.composer').scrollIntoView({ behavior: state.motionReduced ? 'auto' : 'smooth', block: 'start' })
}

function renderAdminPosts() {
  const container = $('#adminPosts')
  $('#managerCount').textContent = `${state.adminPosts.length} ${state.adminPosts.length === 1 ? 'POST' : 'POSTS'}`
  container.innerHTML = state.adminPosts.map((post) => `
    <article class="admin-post">
      <img src="${escapeHTML(post.images[0])}" alt="" />
      <div><small>${escapeHTML(labelForCategory(post.category))}${post.category === 'music' && post.albumName ? ` / ${escapeHTML(post.albumName.toUpperCase())}` : ''}${post.category === 'music' && post.artistName ? ` / ${escapeHTML(post.artistName.toUpperCase())}` : ''}${post.category === 'music' && post.genre ? ` / ${escapeHTML(post.genre.toUpperCase())}` : ''} / ${escapeHTML(formatDate(post.postDate))} ${post.published ? '' : '/ DRAFT'}</small><p>${escapeHTML(post.description || post.albumName || '[Untitled image post]')}</p></div>
      <div class="admin-post-actions"><button type="button" data-edit="${escapeHTML(post.id)}">EDIT</button><button type="button" data-delete="${escapeHTML(post.id)}">DELETE</button></div>
    </article>`).join('') || '<p class="empty-state">No posts yet.</p>'
  $$('[data-edit]', container).forEach((button) => button.addEventListener('click', () => editPost(button.dataset.edit)))
  $$('[data-delete]', container).forEach((button) => button.addEventListener('click', async () => {
    const post = state.adminPosts.find((item) => item.id === button.dataset.delete)
    if (!post || !window.confirm(`Delete this ${post.category} post? This cannot be undone.`)) return
    try { await api(`/api/admin/posts/${post.id}`, { method: 'DELETE' }); await refreshAdminPosts(); await loadPublicPosts() } catch (error) { window.alert(error.message) }
  }))
}

async function refreshAdminPosts() {
  const { posts } = await api('/api/admin/posts')
  state.adminPosts = posts
  renderAdminPosts()
}

function showAdminConsole() {
  $('#adminLogin').hidden = true
  $('#adminConsole').hidden = false
  resetComposer()
  refreshAdminPosts().catch((error) => { $('#postMessage').textContent = error.message })
}

async function changeRoute() {
  const isAdmin = location.hash === '#admin'
  $('#feedView').hidden = isAdmin
  $('.site-header').hidden = isAdmin
  $('.site-footer').hidden = isAdmin
  $('#adminView').classList.toggle('is-active', isAdmin)
  $('#adminView').setAttribute('aria-hidden', String(!isAdmin))
  if (!isAdmin) {
    document.body.style.overflow = ''
    applyPublicRoute()
    return
  }
  document.body.dataset.channel = 'console'
  closePost()
  $('#adminConsole').hidden = true
  $('#adminLogin').hidden = false
  try {
    const status = await api('/api/auth/status')
    if (status.authenticated) showAdminConsole()
    else if (!status.configured) $('#loginMessage').textContent = 'Admin access is not configured. Add ADMIN_PASSWORD to a local .env file.'
  } catch (error) { $('#loginMessage').textContent = error.message }
}

function setupAdmin() {
  const zone = $('#uploadZone')
  const input = $('#images')
  setupComposerControls()
  const acceptFiles = (files) => {
    const valid = [...files].filter((file) => acceptedImageTypes.has(file.type.toLowerCase()))
    state.images.push(...valid.map((file) => ({ kind: 'new', file, preview: URL.createObjectURL(file) })))
    if (valid.length !== files.length) $('#postMessage').textContent = 'Use JPG, PNG, WebP, GIF, or AVIF images.'
    input.value = ''
    renderImagePreview(); updateMiniPreview()
  }
  input.addEventListener('change', (event) => acceptFiles(event.target.files))
  ;['dragenter', 'dragover'].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add('dragging') }))
  ;['dragleave', 'drop'].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove('dragging') }))
  zone.addEventListener('drop', (event) => acceptFiles(event.dataTransfer.files))
  $('#description').addEventListener('input', updateMiniPreview)
  $('#albumName').addEventListener('input', updateMiniPreview)
  $('#artistName').addEventListener('input', updateMiniPreview)
  $('#genre').addEventListener('input', updateMiniPreview)
  $('#lookupAlbumArt').addEventListener('click', findAlbumArt)
  $('#cancelEdit').addEventListener('click', resetComposer)
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const message = $('#loginMessage'); message.textContent = 'CHECKING…'; message.classList.remove('success')
    try {
      await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) })
      $('#password').value = ''; message.textContent = ''; showAdminConsole()
    } catch (error) { message.textContent = error.message }
  })
  $('#logoutButton').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }); location.hash = '#log'
  })
  $('#postForm').addEventListener('submit', async (event) => {
    event.preventDefault()
    const message = $('#postMessage')
    const id = $('#editingId').value
    const form = new FormData()
    form.set('description', $('#description').value)
    form.set('category', $('#category').value)
    form.set('postDate', $('#postDate').value)
    form.set('albumName', $('#albumName').value)
    form.set('artistName', $('#artistName').value)
    form.set('genre', $('#genre').value)
    form.set('ratings', JSON.stringify(currentRatings()))
    form.set('published', String($('#published').checked))
    let uploadIndex = 0
    const imageOrder = state.images.map((item) => item.kind === 'existing' ? { kind: 'existing', source: item.source } : { kind: 'new', uploadIndex: uploadIndex++ })
    form.set('imageOrder', JSON.stringify(imageOrder))
    state.images.filter((item) => item.kind === 'new').forEach((item) => form.append('images', item.file))
    if (!state.images.length) { message.textContent = 'Add at least one image before publishing.'; return }
    $('#savePost').disabled = true; message.textContent = id ? 'SAVING CHANGES…' : 'PUBLISHING…'; message.classList.remove('success')
    try {
      await api(id ? `/api/admin/posts/${id}` : '/api/admin/posts', { method: id ? 'PATCH' : 'POST', body: form })
      message.textContent = id ? 'Changes saved.' : ($('#published').checked ? 'Published.' : 'Draft saved.')
      message.classList.add('success')
      await refreshAdminPosts(); await loadPublicPosts(); resetComposer()
    } catch (error) { message.textContent = error.message } finally { $('#savePost').disabled = false }
  })
}

function setupGeneralEvents() {
  $$('[data-route]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigateToRoute(link.getAttribute('href'))
  }))
  $('#overlayClose').addEventListener('click', closePost)
  overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target.classList.contains('overlay-scrim')) closePost() })
  $('#lightboxClose').addEventListener('click', closeLightbox)
  imageLightbox.addEventListener('click', (event) => { if (event.target === imageLightbox || event.target.classList.contains('lightbox-backdrop')) closeLightbox() })
  document.addEventListener('keydown', (event) => {
    if (imageLightbox.classList.contains('is-open')) {
      if (event.key === 'Escape') closeLightbox()
      return
    }
    if (!overlay.classList.contains('is-open')) return
    if (event.key === 'Escape') closePost()
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const posts = visiblePosts(); const index = posts.findIndex((post) => post.id === state.activePost)
      const next = posts[index + (event.key === 'ArrowRight' ? 1 : -1)]
      if (next) { state.activePost = next.id; renderOverlay(next) }
    }
  })
  window.addEventListener('scroll', () => $('#siteHeader').classList.toggle('scrolled', window.scrollY > 25), { passive: true })
  window.addEventListener('hashchange', changeRoute)
  window.addEventListener('popstate', () => changeRoute())
}

function setupBoot() {
  const boot = $('#bootScreen')
  if (!boot) return
  const seenKey = 'evan-site-boot-seen'
  const root = document.documentElement
  const shouldPlay = root.classList.contains('boot-pending') && !state.motionReduced

  if (!shouldPlay) {
    boot.classList.add('done')
    return
  }

  try { sessionStorage.setItem(seenKey, 'yes') } catch { /* Storage can be unavailable in privacy-restricted contexts. */ }
  boot.classList.add('is-starting')
  window.setTimeout(() => {
    boot.classList.add('done')
    root.classList.remove('boot-pending')
  }, 2900)
}

async function init() {
  setupBoot(); setupPointer(); setupSkySecrets(); setupSceneTargets(); setupAdmin(); setupGeneralEvents(); updateFilterUI()
  document.documentElement.classList.toggle('reduced-motion', state.motionReduced)
  await loadPublicPosts()
  setupScrollStudio()
  await changeRoute()
}

init()
