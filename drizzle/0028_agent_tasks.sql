CREATE TABLE agent_tasks (
 id text PRIMARY KEY NOT NULL,
 coin_id text NOT NULL REFERENCES coins(id),
 goal text NOT NULL,
 next_step text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','blocked','complete','abandoned')),
 evidence text,
 created_at integer NOT NULL,
 updated_at integer NOT NULL
);
CREATE INDEX agent_tasks_coin_idx ON agent_tasks(coin_id,status,updated_at);
