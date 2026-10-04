CREATE TABLE agent_personas (
 coin_id text PRIMARY KEY NOT NULL REFERENCES coins(id),
 content text NOT NULL,
 run_id text NOT NULL,
 updated_at integer NOT NULL
);
CREATE TABLE website_feedback (
 coin_id text NOT NULL REFERENCES coins(id),
 viewer text NOT NULL,
 target text NOT NULL,
 vote text NOT NULL CHECK(vote IN ('helpful','unclear','more')),
 updated_at integer NOT NULL,
 PRIMARY KEY(coin_id,viewer,target)
);
CREATE INDEX website_feedback_coin_idx ON website_feedback(coin_id,updated_at);
