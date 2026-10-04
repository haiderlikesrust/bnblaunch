CREATE TABLE browser_sessions (
 id text PRIMARY KEY NOT NULL, coin_id text NOT NULL REFERENCES coins(id),
 url text NOT NULL, title text NOT NULL DEFAULT '', status text NOT NULL,
 excerpt text NOT NULL DEFAULT '', started_at integer NOT NULL, finished_at integer
);
CREATE INDEX browser_sessions_coin_idx ON browser_sessions(coin_id,started_at);
CREATE TABLE browser_frames (
 id text PRIMARY KEY NOT NULL, session_id text NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
 coin_id text NOT NULL REFERENCES coins(id), position integer NOT NULL, scroll_y integer NOT NULL, base64 text NOT NULL
);
