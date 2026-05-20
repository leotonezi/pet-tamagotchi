import { Outlet } from "react-router-dom";
import { NavBar } from "./NavBar";

export function AppShell() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
