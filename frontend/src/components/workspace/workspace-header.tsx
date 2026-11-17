"use client";

import Link from "next/link";

import { useSidebar } from "@/components/ui/sidebar";
import { getPlatformLogo, getPlatformName } from "@/core/config";
import { env } from "@/env";
import { cn } from "@/lib/utils";

function OpsinTechMark({ className, platformName, platformLogo }: { className?: string; platformName: string; platformLogo: string }) {
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center shrink-0",
        className,
      )}
      aria-label={platformName}
    >
      <img 
        src={platformLogo} 
        alt={`${platformName} Logo`} 
        className="h-full w-full object-contain" 
      />
    </div>
  );
}

export function WorkspaceHeader({ className }: { className?: string }) {
  const { state } = useSidebar();
  const platformName = getPlatformName();
  const platformLogo = getPlatformLogo();
  return (
    <>
      <div
        className={cn(
          "flex h-12 flex-col justify-center",
          className,
        )}
      >
        {state === "collapsed" ? (
          <div className="flex w-full items-center justify-center">
            <OpsinTechMark className="transition-transform hover:scale-105" platformName={platformName} platformLogo={platformLogo} />
          </div>
        ) : (
          <div className="flex items-center px-1">
            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
              <Link href="/" className="text-foreground ml-1 flex items-center gap-2.5 transition-opacity hover:opacity-80">
                <OpsinTechMark platformName={platformName} platformLogo={platformLogo} />
                <span className="truncate text-sm font-semibold tracking-tight">
                  {platformName}
                </span>
              </Link>
            ) : (
              <div className="text-foreground ml-1 flex items-center gap-2.5 cursor-default">
                <OpsinTechMark platformName={platformName} platformLogo={platformLogo} />
                <span className="truncate text-sm font-semibold tracking-tight">
                  {platformName}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
