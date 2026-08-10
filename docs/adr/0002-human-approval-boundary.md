# ADR 0002: AI output stops at a human approval boundary

Status: Accepted

Generation creates a validated proposal and an approval row. Only an approved
plan materializes milestones/tasks, and only an approved customer update becomes
visible to the stakeholder timeline. This keeps retries and regeneration free
of delivery side effects while making the decision auditable.
