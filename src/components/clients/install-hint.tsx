"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Card } from "@/components/ui";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const KEY = "hbs:install-hint-dismissed";
const noopSubscribe = () => () => {};

function readEnv() {
  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(KEY) === "1";
  } catch {
    // storage unavailable (private mode): just show the hint
  }
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return { dismissed, standalone, ios };
}

/** "Add to Home Screen" hint for the client portal (hidden once installed or dismissed). */
export function InstallHint({ appName }: { appName: string }) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [hidden, setHidden] = useState(false);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!mounted || hidden) return null;
  const env = readEnv();
  if (env.dismissed || env.standalone) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
    setHidden(true);
  };

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold">Get the {appName} app</p>
        <p className="mt-0.5 text-sm text-zinc-500">
          {promptEvent
            ? "Install it on your home screen for one-tap access to workouts, bookings and messages."
            : env.ios
              ? "In Safari, tap the Share button, then “Add to Home Screen” for one-tap access."
              : "Use your browser menu and choose “Install app” or “Add to Home screen” for one-tap access."}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {promptEvent ? (
          <Button
            size="sm"
            onClick={async () => {
              await promptEvent.prompt();
              const choice = await promptEvent.userChoice;
              if (choice.outcome === "accepted") setHidden(true);
              setPromptEvent(null);
            }}
          >
            Install
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}
