CREATE TABLE agent_observations (coin_id text PRIMARY KEY NOT NULL REFERENCES coins(id),body text NOT NULL,observed_at integer NOT NULL);
CREATE TABLE agent_signals (id text PRIMARY KEY NOT NULL,coin_id text NOT NULL REFERENCES coins(id),kind text NOT NULL,message text NOT NULL,observed_at integer NOT NULL);
CREATE INDEX agent_signals_coin_idx ON agent_signals(coin_id,observed_at);
