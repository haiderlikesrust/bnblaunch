-- Temporary testing threshold for existing drafts and launched coins.
UPDATE coins SET config=json_set(config,'$.threshold',0.01);
