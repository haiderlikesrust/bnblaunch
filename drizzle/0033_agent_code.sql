CREATE TABLE code_jobs (
 id text PRIMARY KEY NOT NULL,
 coin_id text NOT NULL REFERENCES coins(id),
 status text NOT NULL CHECK(status IN ('queued','running','complete','failed')),
 payload text NOT NULL,
 result text,
 cost_microusd integer NOT NULL,
 created_at integer NOT NULL,
 updated_at integer NOT NULL
);
CREATE INDEX code_jobs_due_idx ON code_jobs(status,updated_at);
CREATE INDEX code_jobs_coin_idx ON code_jobs(coin_id,created_at);
