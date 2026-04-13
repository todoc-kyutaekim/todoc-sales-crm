-- Add profile_url column to doctors table (hospital site link)
ALTER TABLE doctors ADD COLUMN profile_url TEXT DEFAULT '';

-- Create meeting_users join table for many-to-many meetings <-> users (salespeople)
CREATE TABLE IF NOT EXISTS meeting_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_users_meeting ON meeting_users(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_users_user ON meeting_users(user_id);
