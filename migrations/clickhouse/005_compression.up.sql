ALTER TABLE agentstack.sessions MODIFY COLUMN input CODEC(ZSTD(3));
ALTER TABLE agentstack.sessions MODIFY COLUMN output CODEC(ZSTD(3));
ALTER TABLE agentstack.sessions MODIFY COLUMN metadata CODEC(ZSTD(3));
ALTER TABLE agentstack.sessions MODIFY COLUMN error CODEC(ZSTD(3));
ALTER TABLE agentstack.spans MODIFY COLUMN input CODEC(ZSTD(3));
ALTER TABLE agentstack.spans MODIFY COLUMN output CODEC(ZSTD(3));
ALTER TABLE agentstack.spans MODIFY COLUMN metadata CODEC(ZSTD(3));
ALTER TABLE agentstack.events MODIFY COLUMN data CODEC(ZSTD(3));
