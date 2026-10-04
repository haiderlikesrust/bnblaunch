-- Optional AI influencer: a persistent Higgsfield character that posts photos
-- and videos to the coin's connected X account. Rows exist only for opted-in coins.
CREATE TABLE influencers (
 coin_id text PRIMARY KEY NOT NULL REFERENCES coins(id),
 config text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending_launch','awaiting_x','awaiting_funds','designing','training','active','failed')),
 character_id text,
 character_status text,
 design_request text,
 master_asset text,
 master_url text,
 reference_url text,
 run_id text,
 attempts integer NOT NULL DEFAULT 0,
 reserved_microusd integer NOT NULL DEFAULT 0,
 cost_microusd integer NOT NULL DEFAULT 0,
 next_attempt_at integer NOT NULL DEFAULT 0,
 next_post_at integer NOT NULL DEFAULT 0,
 last_error text,
 created_at integer NOT NULL,
 updated_at integer NOT NULL
);
CREATE INDEX influencers_due_idx ON influencers(status,next_attempt_at);
CREATE TABLE influencer_posts (
 id text PRIMARY KEY NOT NULL,
 coin_id text NOT NULL REFERENCES coins(id),
 kind text NOT NULL CHECK(kind IN ('photo','video')),
 status text NOT NULL,
 caption text NOT NULL DEFAULT '',
 scene text NOT NULL DEFAULT '',
 motion text NOT NULL DEFAULT '',
 image_request text,
 video_request text,
 image_url text,
 video_url text,
 still_asset text,
 user_id text,
 media_id text,
 tweet_id text,
 reserved_microusd integer NOT NULL DEFAULT 0,
 cost_microusd integer NOT NULL DEFAULT 0,
 billing text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 posting_at integer,
 next_attempt_at integer NOT NULL DEFAULT 0,
 error text,
 created_at integer NOT NULL,
 updated_at integer NOT NULL
);
CREATE INDEX influencer_posts_coin_idx ON influencer_posts(coin_id,created_at);
CREATE INDEX influencer_posts_due_idx ON influencer_posts(status,next_attempt_at);
CREATE TABLE influencer_assets (
 id text PRIMARY KEY NOT NULL,
 coin_id text NOT NULL REFERENCES coins(id),
 kind text NOT NULL CHECK(kind IN ('reference','master','still')),
 mime text NOT NULL,
 base64 text NOT NULL,
 created_at integer NOT NULL
);
CREATE INDEX influencer_assets_coin_idx ON influencer_assets(coin_id,kind);
-- A wallet-submitted launch hash is recorded before confirmation, so any
-- device can resume verification and a second launch is not prepared meanwhile.
ALTER TABLE prepared_launches ADD COLUMN submitted_hash text;
ALTER TABLE prepared_launches ADD COLUMN submitted_at integer;
-- Only metadata SHEN pinned for an authorization may be launched with it.
ALTER TABLE launch_authorizations ADD COLUMN metadata_cid text;
-- Public coin pages read events and operations by coin.
CREATE INDEX events_coin_time_idx ON events(coin_id,created_at);
CREATE INDEX operations_coin_time_idx ON agent_operations(coin_id,created_at);
