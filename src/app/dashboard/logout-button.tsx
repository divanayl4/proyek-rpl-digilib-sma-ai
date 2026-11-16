"use client";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button 
      onClick={() => signOut({ callbackUrl: '/login' })} 
      className="inline-flex items-center justify-center min-h-11 px-3 rounded-lg text-sm font-semibold text-danger hover:bg-danger-bg transition-colors"
    >
      Keluar
    </button>
  );
}
