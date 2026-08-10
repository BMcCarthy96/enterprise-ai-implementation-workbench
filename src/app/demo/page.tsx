import { Suspense } from "react";
import { DemoCheckpointLauncher } from "@/app/DemoCheckpointLauncher";

export const metadata = {
  title: "Demo checkpoint",
};

export default function DemoCheckpointPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#07111f]" />}><DemoCheckpointLauncher /></Suspense>;
}
