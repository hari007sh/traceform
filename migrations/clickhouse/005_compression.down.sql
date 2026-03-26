ALTER TABLE agentstack.sessions MODIFY COLUMN input CODEC(LZ4);
ALTER TABLE agentstack.sessions MODIFY COLUMN output CODEC(LZ4);
ALTER TABLE agentstack.sessions MODIFY COLUMN metadata CODEC(LZ4);
ALTER TABLE agentstack.sessions MODIFY COLUMN error CODEC(LZ4);
ALTER TABLE agentstack.spans MODIFY COLUMN input CODEC(LZ4);
ALTER TABLE agentstack.spans MODIFY COLUMN output CODEC(LZ4);
ALTER TABLE agentstack.spans MODIFY COLUMN metadata CODEC(LZ4);
ALTER TABLE agentstack.events MODIFY COLUMN data CODEC(LZ4);
