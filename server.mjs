import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { createServer } from 'node:http'

const root = resolve('.')
const publicDir = join(root, 'public')
const dataDir = join(root, 'data')
const uploadsDir = join(root, 'uploads')
const postsFile = join(dataDir, 'posts.json')

for (const directory of [dataDir, uploadsDir]) {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
}

function loadEnv() {
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

loadEnv()
const port = Number(process.env.PORT || 3000)
const adminPassword = process.env.ADMIN_PASSWORD || ''
const sessionSecret = process.env.SESSION_SECRET || adminPassword
const maxUploadBytes = 20 * 1024 * 1024
let lastMusicBrainzRequestAt = 0

const starterPosts = [
  {
    id: 'midnight-drive', createdAt: '2026-08-20T12:00:00.000Z', postDate: '2026-08-18', category: 'game', published: true,
    description: 'Finally got around to playing this again. Still holds up.',
    images: [
      'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1600&q=88',
      'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?auto=format&fit=crop&w=1400&q=88'
    ]
  },
  {
    id: 'headphones-on', createdAt: '2026-08-16T12:00:00.000Z', postDate: '2026-08-15', category: 'music', published: true,
    description: 'Been listening to this album constantly this week.',
    images: [
      'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1700&q=88',
      'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1300&q=88',
      'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1300&q=88'
    ]
  },
  {
    id: 'green-screen', createdAt: '2026-08-08T12:00:00.000Z', postDate: '2026-08-08', category: 'game', published: true,
    description: 'A little too much time in the menu screens. The UI is half the atmosphere.',
    images: ['https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1700&q=88']
  },
  {
    id: 'summer-rain', createdAt: '2026-08-02T12:00:00.000Z', postDate: '2026-08-01', category: 'music', published: true,
    description: '',
    images: [
      'https://images.unsplash.com/photo-1519608487953-e999c86e7454?auto=format&fit=crop&w=1300&q=88',
      'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1300&q=88'
    ]
  },
  {
    id: 'side-quest', createdAt: '2026-07-24T12:00:00.000Z', postDate: '2026-07-23', category: 'other', published: true,
    description: 'Found this on a shelf. That was enough of a reason to take the long way home.',
    images: ['https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1700&q=88']
  }
]

function readPosts() {
  if (!existsSync(postsFile)) return starterPosts
  try { return JSON.parse(readFileSync(postsFile, 'utf8')) } catch { return starterPosts }
}

function writePosts(posts) {
  writeFileSync(postsFile, JSON.stringify(posts, null, 2))
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((item) => {
    const index = item.indexOf('=')
    return index === -1 ? [] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))]
  }).filter(Boolean))
}

function sign(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('base64url')
}

function authenticated(request) {
  if (!adminPassword || !sessionSecret) return false
  const token = parseCookies(request).aero_archive_admin
  if (!token) return false
  const [expiry, signature] = token.split('.')
  if (!expiry || !signature || Number(expiry) < Date.now()) return false
  const expected = sign(expiry)
  try { return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) } catch { return false }
}

function setSession(res) {
  const expiry = String(Date.now() + 1000 * 60 * 60 * 24 * 14)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `aero_archive_admin=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600${secure}`)
}

function clearSession(res) {
  res.setHeader('Set-Cookie', 'aero_archive_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxUploadBytes) { reject(new Error('Files are limited to 20 MB total.')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function parseFormData(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2]
  if (!boundary) throw new Error('Malformed upload request.')
  const divider = Buffer.from(`--${boundary}`)
  const fields = {}
  const files = []
  let cursor = buffer.indexOf(divider) + divider.length + 2
  while (cursor > divider.length + 1 && cursor < buffer.length) {
    const next = buffer.indexOf(divider, cursor)
    if (next === -1) break
    const part = buffer.subarray(cursor, next - 2)
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8')
      const value = part.subarray(headerEnd + 4)
      const disposition = headers.match(/name="([^"]+)"/i)
      const fileName = headers.match(/filename="([^"]*)"/i)
      if (disposition) {
        if (fileName?.[1]) files.push({ field: disposition[1], name: fileName[1], type: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream', data: value })
        else fields[disposition[1]] = value.toString('utf8')
      }
    }
    cursor = next + divider.length + 2
  }
  return { fields, files }
}

function saveUploads(files) {
  const accepted = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
  return files.filter((file) => accepted.has(file.type.toLowerCase())).map((file) => {
    const extension = extname(file.name).toLowerCase() || ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }[file.type] || '')
    const name = `${randomUUID()}${extension}`
    writeFileSync(join(uploadsDir, name), file.data)
    return `/uploads/${name}`
  })
}

function normalizedMusicField(value, maximum) {
  return String(value || '').trim().replace(/[\r\n]/g, ' ').slice(0, maximum)
}

function musicBrainzArtistName(release) {
  return (release['artist-credit'] || []).map((credit) => `${credit.name || credit.artist?.name || ''}${credit.joinphrase || ''}`).join('').trim()
}

function displayGenre(value) {
  return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function musicBrainzFetch(url) {
  const pause = Math.max(0, 1100 - (Date.now() - lastMusicBrainzRequestAt))
  if (pause) await new Promise((resolvePause) => setTimeout(resolvePause, pause))
  lastMusicBrainzRequestAt = Date.now()
  return fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'PersonalMediaArchive/1.0 (self-hosted personal archive)' } })
}

async function findMusicGenre(release) {
  const releaseGroupId = release['release-group']?.id
  if (!releaseGroupId) return ''
  try {
    const lookup = new URL(`https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(releaseGroupId)}`)
    lookup.searchParams.set('inc', 'genres')
    lookup.searchParams.set('fmt', 'json')
    const response = await musicBrainzFetch(lookup)
    if (!response.ok) return ''
    const genres = (await response.json()).genres || []
    const primary = [...genres].sort((left, right) => Number(right.count || 0) - Number(left.count || 0))[0]?.name
    return normalizedMusicField(displayGenre(primary), 80)
  } catch {
    return ''
  }
}

async function findAlbumArt(artistValue, albumValue) {
  const artist = normalizedMusicField(artistValue, 120)
  const album = normalizedMusicField(albumValue, 120)
  if (!artist || !album) throw new Error('Add both an artist and album name first.')
  const query = `artist:"${artist.replace(/"/g, ' ')}" AND release:"${album.replace(/"/g, ' ')}"`
  const search = new URL('https://musicbrainz.org/ws/2/release/')
  search.searchParams.set('query', query)
  search.searchParams.set('fmt', 'json')
  search.searchParams.set('limit', '5')
  const searchResponse = await musicBrainzFetch(search)
  if (!searchResponse.ok) throw new Error('The music catalog is unavailable right now. Please try again.')
  const releases = (await searchResponse.json()).releases || []
  for (const release of releases.slice(0, 5)) {
    if (!release?.id) continue
    const coverResponse = await fetch(`https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-1200`, { headers: { Accept: 'image/*' } })
    const contentType = (coverResponse.headers.get('content-type') || '').split(';')[0].toLowerCase()
    if (!coverResponse.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(contentType)) continue
    const body = Buffer.from(await coverResponse.arrayBuffer())
    if (!body.length || body.length > 10 * 1024 * 1024) continue
    return { body, contentType, albumName: normalizedMusicField(release.title, 120), artistName: normalizedMusicField(musicBrainzArtistName(release), 120), genre: await findMusicGenre(release) }
  }
  throw new Error('No matching album art was found. You can still add a cover manually.')
}

function orderedImages(fields, existingImages, additions) {
  if (!fields.imageOrder) return [...existingImages, ...additions]
  let order
  try { order = JSON.parse(fields.imageOrder || '[]') } catch { order = null }
  if (!Array.isArray(order)) return [...existingImages, ...additions]
  const allowedExisting = new Set(existingImages)
  const usedExisting = new Set()
  const usedAdditions = new Set()
  const images = []
  for (const item of order) {
    if (item?.kind === 'existing' && typeof item.source === 'string' && allowedExisting.has(item.source) && !usedExisting.has(item.source)) {
      usedExisting.add(item.source)
      images.push(item.source)
    }
    if (item?.kind === 'new' && Number.isInteger(item.uploadIndex) && additions[item.uploadIndex] && !usedAdditions.has(item.uploadIndex)) {
      usedAdditions.add(item.uploadIndex)
      images.push(additions[item.uploadIndex])
    }
  }
  return images
}

const ratingCriteria = ['replayability', 'length', 'story', 'graphics', 'music', 'gameplay']

function ratingsFromFields(fields, category) {
  if (category !== 'game') return { ratings: {}, overallRating: null }
  let source = {}
  try { source = JSON.parse(fields.ratings || '{}') } catch { /* Invalid ratings are ignored. */ }
  const ratings = Object.fromEntries(ratingCriteria.map((criterion) => {
    const value = Number(source[criterion])
    return Number.isFinite(value) && value >= 1 && value <= 10 ? [criterion, Math.round(value * 10) / 10] : null
  }).filter(Boolean))
  const values = Object.values(ratings)
  return { ratings, overallRating: values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10 : null }
}

function postFromFields(fields, existing = {}) {
  const category = ['game', 'music', 'other'].includes(fields.category) ? fields.category : 'other'
  const { tags, ratings, overallRating, ...post } = existing
  return {
    ...post,
    description: (fields.description || '').trim().slice(0, 1000),
    category,
    albumName: category === 'music' ? (fields.albumName || '').trim().slice(0, 120) : '',
    artistName: category === 'music' ? (fields.artistName || '').trim().slice(0, 120) : '',
    genre: category === 'music' ? (fields.genre || '').trim().slice(0, 80) : '',
    postDate: /^\d{4}-\d{2}-\d{2}$/.test(fields.postDate || '') ? fields.postDate : new Date().toISOString().slice(0, 10),
    ...ratingsFromFields(fields, category),
    published: fields.published === 'true'
  }
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon' }

function serveArchivePage(res, page) {
  const index = readFileSync(join(publicDir, 'index.html'), 'utf8')
  const body = `<body data-page="${page}" data-channel="${page}">`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(index.replace('<body data-page="log" data-channel="log">', body))
}

function serveFile(res, pathname) {
  const candidate = pathname.startsWith('/uploads/') ? join(uploadsDir, pathname.slice('/uploads/'.length)) : join(publicDir, pathname === '/' ? 'index.html' : pathname)
  const file = normalize(candidate)
  if ((!file.startsWith(publicDir) && !file.startsWith(uploadsDir)) || !existsSync(file)) return false
  res.writeHead(200, { 'Content-Type': mimeTypes[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': pathname.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
  createReadStream(file).pipe(res)
  return true
}

const server = createServer(async (request, res) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  const method = request.method || 'GET'
  try {
    if (method === 'GET' && url.pathname === '/api/posts') {
      const posts = readPosts().filter((post) => post.published).sort((a, b) => new Date(b.postDate) - new Date(a.postDate))
      return json(res, 200, { posts })
    }
    if (method === 'GET' && url.pathname === '/api/auth/status') return json(res, 200, { authenticated: authenticated(request), configured: Boolean(adminPassword) })
    if (method === 'POST' && url.pathname === '/api/auth/login') {
      if (!adminPassword) return json(res, 503, { error: 'Admin access is not configured. Add ADMIN_PASSWORD to .env.' })
      const body = JSON.parse((await readBody(request)).toString('utf8') || '{}')
      const candidate = Buffer.from(String(body.password || ''))
      const expected = Buffer.from(adminPassword)
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return json(res, 401, { error: 'That passphrase did not match.' })
      setSession(res)
      return json(res, 200, { authenticated: true })
    }
    if (method === 'POST' && url.pathname === '/api/auth/logout') { clearSession(res); return json(res, 200, { ok: true }) }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!authenticated(request)) return json(res, 401, { error: 'Authentication required.' })
      if (method === 'GET' && url.pathname === '/api/admin/posts') return json(res, 200, { posts: readPosts().sort((a, b) => new Date(b.postDate) - new Date(a.postDate)) })
      if (method === 'GET' && url.pathname === '/api/admin/music-art') {
        const cover = await findAlbumArt(url.searchParams.get('artist'), url.searchParams.get('album'))
        res.writeHead(200, { 'Content-Type': cover.contentType, 'Cache-Control': 'no-store', 'X-Archive-Album': encodeURIComponent(cover.albumName), 'X-Archive-Artist': encodeURIComponent(cover.artistName), 'X-Archive-Genre': encodeURIComponent(cover.genre) })
        res.end(cover.body)
        return
      }
      const id = url.pathname.match(/^\/api\/admin\/posts\/([^/]+)$/)?.[1]
      if (method === 'POST' && url.pathname === '/api/admin/posts') {
        const { fields, files } = parseFormData(await readBody(request), request.headers['content-type'] || '')
        const images = orderedImages(fields, [], saveUploads(files))
        if (!images.length) return json(res, 400, { error: 'Add at least one image.' })
        const posts = readPosts()
        const post = { id: randomUUID(), createdAt: new Date().toISOString(), ...postFromFields(fields), images }
        posts.unshift(post); writePosts(posts)
        return json(res, 201, { post })
      }
      if (id && method === 'PATCH') {
        const { fields, files } = parseFormData(await readBody(request), request.headers['content-type'] || '')
        const posts = readPosts(); const index = posts.findIndex((post) => post.id === id)
        if (index === -1) return json(res, 404, { error: 'Post not found.' })
        const additions = saveUploads(files)
        posts[index] = { ...postFromFields(fields, posts[index]), images: orderedImages(fields, posts[index].images, additions) }
        if (!posts[index].images.length) return json(res, 400, { error: 'A post needs at least one image.' })
        writePosts(posts); return json(res, 200, { post: posts[index] })
      }
      if (id && method === 'DELETE') {
        const posts = readPosts(); const next = posts.filter((post) => post.id !== id)
        if (next.length === posts.length) return json(res, 404, { error: 'Post not found.' })
        writePosts(next); return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'Not found.' })
    }
    const archivePage = { '/': 'log', '/games': 'games', '/music': 'music' }[url.pathname]
    if (method === 'GET' && archivePage) return serveArchivePage(res, archivePage)
    if (method === 'GET' && !url.pathname.startsWith('/api/') && (serveFile(res, url.pathname) || serveFile(res, '/'))) return
    json(res, 404, { error: 'Not found.' })
  } catch (error) {
    console.error(error)
    json(res, error.message?.includes('20 MB') ? 413 : 400, { error: error.message || 'Something went wrong.' })
  }
})

server.listen(port, () => console.log(`Aero Archive → http://localhost:${port}`))
