CREATE TYPE "public"."ai_run_artifact_type" AS ENUM('plan', 'customer_update', 'document_ingest', 'eval');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_call_operation" AS ENUM('generate', 'repair', 'judge', 'embed');--> statement-breakpoint
CREATE TYPE "public"."ai_call_usage_source" AS ENUM('reported', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."ai_call_outcome" AS ENUM('valid', 'invalid', 'blocked', 'failed');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"artifact_type" "ai_run_artifact_type" NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"status" "ai_run_status" DEFAULT 'running' NOT NULL,
	"final_outcome" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8),
	"latency_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"operation" "ai_call_operation" NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"usage_source" "ai_call_usage_source" NOT NULL,
	"cost_usd" numeric(12, 8),
	"latency_ms" integer,
	"outcome" "ai_call_outcome" NOT NULL,
	"error_kind" text,
	"provider_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "ai_runs_org_created_idx" ON "ai_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_project_idx" ON "ai_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_runs_job_idx" ON "ai_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ai_calls_run_sequence_idx" ON "ai_calls" USING btree ("ai_run_id","sequence");--> statement-breakpoint
CREATE INDEX "ai_calls_org_created_idx" ON "ai_calls" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
