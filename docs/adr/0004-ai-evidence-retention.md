# ADR 0004: Retain inspectable evidence without retaining raw content

Status: Accepted

AI runs retain provider/model, usage source, cost, latency, validation,
grounding/citation coverage, and outcome. Raw prompts, document chunks, and
model output are excluded. Org admins can tune bounded detail retention and a
scheduled ledger records what was removed.
