CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  post_date TEXT NOT NULL,
  category TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  ratings TEXT NOT NULL DEFAULT '{}',
  overall_rating REAL,
  images TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS posts_published_date ON posts (published, post_date DESC);

INSERT OR IGNORE INTO posts (id, created_at, post_date, category, published, description, ratings, overall_rating, images) VALUES
  ('midnight-drive', '2026-08-20T12:00:00.000Z', '2026-08-18', 'game', 1, 'Finally got around to playing this again. Still holds up.', '{}', NULL, '["https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1600&q=88","https://images.unsplash.com/photo-1552820728-8b83bb6b773f?auto=format&fit=crop&w=1400&q=88"]'),
  ('headphones-on', '2026-08-16T12:00:00.000Z', '2026-08-15', 'music', 1, 'Been listening to this album constantly this week.', '{}', NULL, '["https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1700&q=88","https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1300&q=88","https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1300&q=88"]'),
  ('green-screen', '2026-08-08T12:00:00.000Z', '2026-08-08', 'game', 1, 'A little too much time in the menu screens. The UI is half the atmosphere.', '{}', NULL, '["https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1700&q=88"]'),
  ('summer-rain', '2026-08-02T12:00:00.000Z', '2026-08-01', 'music', 1, '', '{}', NULL, '["https://images.unsplash.com/photo-1519608487953-e999c86e7454?auto=format&fit=crop&w=1300&q=88","https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1300&q=88"]'),
  ('side-quest', '2026-07-24T12:00:00.000Z', '2026-07-23', 'other', 1, 'Found this on a shelf. That was enough of a reason to take the long way home.', '{}', NULL, '["https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1700&q=88"]');
