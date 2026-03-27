ALTER TABLE traceform.sessions MODIFY COLUMN input CODEC(LZ4);
ALTER TABLE traceform.sessions MODIFY COLUMN output CODEC(LZ4);
ALTER TABLE traceform.sessions MODIFY COLUMN metadata CODEC(LZ4);
ALTER TABLE traceform.sessions MODIFY COLUMN error CODEC(LZ4);
ALTER TABLE traceform.spans MODIFY COLUMN input CODEC(LZ4);
ALTER TABLE traceform.spans MODIFY COLUMN output CODEC(LZ4);
ALTER TABLE traceform.spans MODIFY COLUMN metadata CODEC(LZ4);
ALTER TABLE traceform.events MODIFY COLUMN data CODEC(LZ4);
