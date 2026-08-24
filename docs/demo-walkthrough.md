# Interactive demo walkthrough

Open the [live demo](https://enterprise-ai-implementation-workbe.vercel.app/demo?checkpoint=portfolio-health). It creates a short-lived sample workspace, so no account or password is needed.

## A quick pass

The first screen shows the project portfolio. Open **Order Intake Automation** and skim the requirements, the document evidence, and the current plan. The plan page shows where the source text was used and which checks ran before the result reached review.

Use the role switcher in the top bar to move to **Solutions Engineer**. Open **Patient Onboarding Portal**, go to **Plan**, and choose **Generate implementation plan**. The request is queued in the background. Wait for the new plan to appear with a pending review status.

Switch to **Implementation Manager** and open **Approvals**. Review the plan, then approve it. The approval is the point where the draft can change delivery data. Open the project board and look for the new milestones and tasks.

Switch to **Customer Stakeholder**. Only the assigned customer project remains visible, and the view is read-only. This is the same tenant boundary used by the API and database policies.

## A deeper pass

Open **AI Evidence** from a completed plan. Look at the source references, validation result, repair attempt, token counts, latency, and pricing status. Mock runs are labeled as fixtures or deterministic runs, so they are easy to tell apart from a live provider call.

Open **Operations** to see failed or dead-lettered work. A retry keeps the attempt history and sends the job through the same worker path.

The demo allows two plan generations per browser session. A reset starts a fresh isolated workspace when you want to repeat the flow.

## What to say while showing it

“This is a small implementation workflow rather than a chat screen. Requirements become a background job, the result is checked and recorded, and a person has to approve it before anything is added to the delivery board. The evidence page shows what the model used and what the system checked. The role switch shows the same project through an internal and customer view, with access enforced at the API and database layers.”
