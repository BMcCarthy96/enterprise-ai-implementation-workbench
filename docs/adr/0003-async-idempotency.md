# ADR 0003: Postgres is the asynchronous source of truth

Status: Accepted

SQS messages contain only a job id. A worker resolves the row, atomically claims
queued work, and persists attempts/backoff/dead-letter state. Publish happens
after commit and a reconciliation pass repairs a database/SQS boundary failure.
Duplicate delivery is expected and harmless.
