const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const SESSION_MAX_AGE = 60 * 60 * 24 * 14
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
const imageExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }
const ratingCriteria = ['replayability', 'length', 'story', 'graphics', 'music', 'gameplay']
const encoder = new TextEncoder()
const musicBrainzQuerySpecialCharacters = new Set(['+', '-', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':', '\\', '/', '&', '|'])
let lastMusicBrainzRequestAt = 0

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function error(message, status = 400) {
  return json({ error: message }, status)
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map((item) => {
    const index = item.indexOf('=')
    return index === -1 ? [] : [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))]
  }).filter(Boolean))
}

function base64url(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))))
}

function constantTimeEqual(left, right) {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

async function authenticated(request, env) {
  const password = env.ADMIN_PASSWORD || ''
  const sessionSecret = env.SESSION_SECRET || password
  if (!password || !sessionSecret) return false
  const token = parseCookies(request).aero_archive_admin
  if (!token) return false
  const [expiry, signature] = token.split('.')
  if (!expiry || !signature || Number(expiry) < Date.now()) return false
  return constantTimeEqual(signature, await sign(expiry, sessionSecret))
}

async function setSession(response, request, env) {
  const expiry = String(Date.now() + SESSION_MAX_AGE * 1000)
  const sessionSecret = env.SESSION_SECRET || env.ADMIN_PASSWORD
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  response.headers.append('Set-Cookie', `aero_archive_admin=${expiry}.${await sign(expiry, sessionSecret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`)
  return response
}

function clearSession(response) {
  response.headers.append('Set-Cookie', 'aero_archive_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  return response
}

function safeJSON(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function rowToPost(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    postDate: row.post_date,
    category: row.category,
    published: Boolean(row.published),
    description: row.description,
    albumName: row.album_name || '',
    artistName: row.artist_name || '',
    genre: row.genre || '',
    ratings: safeJSON(row.ratings, {}),
    overallRating: row.overall_rating === null ? null : Number(row.overall_rating),
    images: safeJSON(row.images, [])
  }
}

async function readPosts(env, includeDrafts = false) {
  const query = includeDrafts
    ? 'SELECT * FROM posts ORDER BY post_date DESC, created_at DESC'
    : 'SELECT * FROM posts WHERE published = 1 ORDER BY post_date DESC, created_at DESC'
  const { results } = await env.DB.prepare(query).all()
  return results.map(rowToPost)
}

async function findPost(env, id) {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first()
  return row ? rowToPost(row) : null
}

function ratingsFromFields(form, category) {
  if (category !== 'game') return { ratings: {}, overallRating: null }
  const source = safeJSON(String(form.get('ratings') || '{}'), {})
  const ratings = Object.fromEntries(ratingCriteria.map((criterion) => {
    const value = Number(source[criterion])
    return Number.isFinite(value) && value >= 1 && value <= 10 ? [criterion, Math.round(value * 10) / 10] : null
  }).filter(Boolean))
  const values = Object.values(ratings)
  return { ratings, overallRating: values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10 : null }
}

function postFromForm(form, existing = {}) {
  const category = ['game', 'music', 'other'].includes(form.get('category')) ? form.get('category') : 'other'
  return {
    ...existing,
    description: String(form.get('description') || '').trim().slice(0, 1000),
    category,
    albumName: category === 'music' ? String(form.get('albumName') || '').trim().slice(0, 120) : '',
    artistName: category === 'music' ? String(form.get('artistName') || '').trim().slice(0, 120) : '',
    genre: category === 'music' ? String(form.get('genre') || '').trim().slice(0, 80) : '',
    postDate: /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('postDate') || '')) ? String(form.get('postDate')) : new Date().toISOString().slice(0, 10),
    ...ratingsFromFields(form, category),
    published: form.get('published') === 'true'
  }
}

function validUpload(value) {
  return value && typeof value === 'object' && typeof value.type === 'string' && typeof value.stream === 'function'
}

async function saveUploads(form, env) {
  const files = form.getAll('images').filter(validUpload)
  const size = files.reduce((total, file) => total + Number(file.size || 0), 0)
  if (size > MAX_UPLOAD_BYTES) throw new Error('Files are limited to 20 MB total.')
  const uploads = []
  for (const file of files) {
    const type = file.type.toLowerCase()
    if (!acceptedImageTypes.has(type)) continue
    const key = `uploads/${crypto.randomUUID()}${imageExtensions[type] || ''}`
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: type } })
    uploads.push(`/uploads/${key.slice('uploads/'.length)}`)
  }
  return uploads
}

function normalizedMusicField(value, maximum) {
  return String(value || '').trim().replace(/[\r\n]/g, ' ').slice(0, maximum)
}

function escapeMusicBrainzQuery(value) {
  return [...String(value)].map((character) => musicBrainzQuerySpecialCharacters.has(character) ? `\\${character}` : character).join('')
}

function musicBrainzMatchScore(release, artist, album) {
  const normalized = (value) => String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const expectedArtist = normalized(artist)
  const expectedAlbum = normalized(album)
  const releaseArtist = normalized(musicBrainzArtistName(release))
  const releaseAlbum = normalized(release.title)
  let score = releaseAlbum === expectedAlbum ? 20 : releaseAlbum.includes(expectedAlbum) ? 10 : 0
  if (releaseArtist === expectedArtist) score += 12
  else if (releaseArtist.includes(expectedArtist) || expectedArtist.includes(releaseArtist)) score += 6
  return score
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
  return fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'EvansBlog/1.0 (https://evanvaranblog.com/)' } })
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
  const queries = [
    `artist:"${escapeMusicBrainzQuery(artist)}" AND release:"${escapeMusicBrainzQuery(album)}"`,
    `release:"${escapeMusicBrainzQuery(album)}"`
  ]
  const checkedReleases = new Set()

  for (const query of queries) {
    const search = new URL('https://musicbrainz.org/ws/2/release/')
    search.searchParams.set('query', query)
    search.searchParams.set('fmt', 'json')
    search.searchParams.set('limit', '10')
    const searchResponse = await musicBrainzFetch(search)
    if (!searchResponse.ok) throw new Error('The music catalog is unavailable right now. Please try again.')
    const releases = ((await searchResponse.json()).releases || [])
      .sort((left, right) => musicBrainzMatchScore(right, artist, album) - musicBrainzMatchScore(left, artist, album))

    for (const release of releases) {
      if (!release?.id || checkedReleases.has(release.id)) continue
      checkedReleases.add(release.id)
      const coverResponse = await fetch(`https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-1200`, { headers: { Accept: 'image/*' } })
      const contentType = (coverResponse.headers.get('content-type') || '').split(';')[0].toLowerCase()
      if (!coverResponse.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(contentType)) continue
      const body = await coverResponse.arrayBuffer()
      if (!body.byteLength || body.byteLength > 10 * 1024 * 1024) continue
      return { body, contentType, albumName: normalizedMusicField(release.title, 120), artistName: normalizedMusicField(musicBrainzArtistName(release), 120), genre: await findMusicGenre(release) }
    }
  }
  throw new Error('No matching album art was found. You can still add a cover manually.')
}

function orderedImages(form, existingImages, additions) {
  const order = safeJSON(String(form.get('imageOrder') || ''), null)
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

async function savePost(env, post) {
  await env.DB.prepare(`INSERT INTO posts (id, created_at, post_date, category, published, description, album_name, artist_name, genre, ratings, overall_rating, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, post_date = excluded.post_date, category = excluded.category,
      published = excluded.published, description = excluded.description, album_name = excluded.album_name, artist_name = excluded.artist_name, genre = excluded.genre, ratings = excluded.ratings, overall_rating = excluded.overall_rating, images = excluded.images`)
    .bind(post.id, post.createdAt, post.postDate, post.category, post.published ? 1 : 0, post.description, post.albumName, post.artistName, post.genre, JSON.stringify(post.ratings), post.overallRating, JSON.stringify(post.images)).run()
}

async function deleteRemovedUploads(env, previousImages, nextImages) {
  const removed = previousImages.filter((source) => source.startsWith('/uploads/') && !nextImages.includes(source)).map((source) => `uploads/${source.slice('/uploads/'.length)}`)
  if (removed.length) await env.MEDIA.delete(removed)
}

async function api(request, env, pathname) {
  const method = request.method
  if (method === 'GET' && pathname === '/api/posts') return json({ posts: await readPosts(env) })
  if (method === 'GET' && pathname === '/api/auth/status') return json({ authenticated: await authenticated(request, env), configured: Boolean(env.ADMIN_PASSWORD) })
  if (method === 'POST' && pathname === '/api/auth/login') {
    if (!env.ADMIN_PASSWORD) return error('Admin access is not configured. Add ADMIN_PASSWORD as a Worker secret.', 503)
    const body = await request.json().catch(() => ({}))
    if (!constantTimeEqual(String(body.password || ''), env.ADMIN_PASSWORD)) return error('That passphrase did not match.', 401)
    return setSession(json({ authenticated: true }), request, env)
  }
  if (method === 'POST' && pathname === '/api/auth/logout') return clearSession(json({ ok: true }))
  if (!pathname.startsWith('/api/admin/')) return error('Not found.', 404)
  if (!await authenticated(request, env)) return error('Authentication required.', 401)
  if (method === 'GET' && pathname === '/api/admin/posts') return json({ posts: await readPosts(env, true) })
  if (method === 'GET' && pathname === '/api/admin/music-art') {
    try {
      const url = new URL(request.url)
      const cover = await findAlbumArt(url.searchParams.get('artist'), url.searchParams.get('album'))
      return new Response(cover.body, { headers: { 'Content-Type': cover.contentType, 'Cache-Control': 'no-store', 'X-Archive-Album': encodeURIComponent(cover.albumName), 'X-Archive-Artist': encodeURIComponent(cover.artistName), 'X-Archive-Genre': encodeURIComponent(cover.genre) } })
    } catch (exception) {
      return error(exception.message || 'No matching album art was found.', 404)
    }
  }

  if (method === 'POST' && pathname === '/api/admin/posts') {
    const form = await request.formData()
    const additions = await saveUploads(form, env)
    const images = orderedImages(form, [], additions)
    if (!images.length) return error('Add at least one image.')
    const post = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...postFromForm(form), images }
    await savePost(env, post)
    return json({ post }, 201)
  }

  const id = pathname.match(/^\/api\/admin\/posts\/([^/]+)$/)?.[1]
  if (!id) return error('Not found.', 404)
  const existing = await findPost(env, decodeURIComponent(id))
  if (!existing) return error('Post not found.', 404)
  if (method === 'PATCH') {
    const form = await request.formData()
    const additions = await saveUploads(form, env)
    const images = orderedImages(form, existing.images, additions)
    if (!images.length) return error('A post needs at least one image.')
    const post = { ...postFromForm(form, existing), images }
    await savePost(env, post)
    await deleteRemovedUploads(env, existing.images, images)
    return json({ post })
  }
  if (method === 'DELETE') {
    await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(existing.id).run()
    await deleteRemovedUploads(env, existing.images, [])
    return json({ ok: true })
  }
  return error('Not found.', 404)
}

async function serveUpload(request, env, pathname) {
  const key = `uploads/${pathname.slice('/uploads/'.length)}`
  const object = await env.MEDIA.get(key)
  if (!object) return error('Not found.', 404)
  const headers = new Headers({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream' })
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}

async function serveArchivePage(request, env, page) {
  const index = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
  if (!index.ok) return index
  const html = (await index.text()).replace('<body data-page="log" data-channel="log">', `<body data-page="${page}" data-channel="${page}">`)
  const headers = new Headers(index.headers)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  headers.set('Cache-Control', 'no-cache')
  return new Response(html, { status: 200, headers })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (url.pathname.startsWith('/api/')) return await api(request, env, url.pathname)
      if (url.pathname.startsWith('/uploads/') && ['GET', 'HEAD'].includes(request.method)) return await serveUpload(request, env, url.pathname)
      const page = { '/': 'log', '/games': 'games', '/music': 'music' }[url.pathname]
      if (page && request.method === 'GET') return await serveArchivePage(request, env, page)
      if (request.method === 'GET' || request.method === 'HEAD') return env.ASSETS.fetch(request)
      return error('Not found.', 404)
    } catch (exception) {
      console.error(exception)
      return error(exception.message?.includes('20 MB') ? exception.message : 'Something went wrong.', exception.message?.includes('20 MB') ? 413 : 400)
    }
  }
}
