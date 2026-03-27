ALTER TABLE traceform.sessions MODIFY COLUMN input CODEC(ZSTD(3));
ALTER TABLE traceform.sessions MODIFY COLUMN output CODEC(ZSTD(3));
ALTER TABLE traceform.sessions MODIFY COLUMN metadata CODEC(ZSTD(3));
ALTER TABLE traceform.sessions MODIFY COLUMN error CODEC(ZSTD(3));
ALTER TABLE traceform.spans MODIFY COLUMN input CODEC(ZSTD(3));
ALTER TABLE traceform.spans MODIFY COLUMN output CODEC(ZSTD(3));
ALTER TABLE traceform.spans MODIFY COLUMN metadata CODEC(ZSTD(3));
ALTER TABLE traceform.events MODIFY COLUMN data CODEC(ZSTD(3));
