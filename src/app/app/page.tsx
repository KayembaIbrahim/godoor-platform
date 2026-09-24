"use client";

import dynamic from "next/dynamic";

const CustomerHome = dynamic(() => import("./CustomerHome"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-go border-t-transparent" />
    </div>
  ),
});

export default function AppPage() {
  return <CustomerHome />;
}
