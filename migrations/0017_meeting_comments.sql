-- Meeting comments with @mentions support
CREATE TABLE IF NOT EXISTS meeting_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  mentions TEXT, -- JSON array of mentioned user_ids
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mc_meeting ON meeting_comments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_mc_user ON meeting_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_mc_created ON meeting_comments(created_at);

-- Mention notifications (for future "내게 멘션됨" 알림)
CREATE TABLE IF NOT EXISTS mention_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,    -- the mentioned user
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (comment_id) REFERENCES meeting_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mn_user ON mention_notifications(user_id, read_at);
