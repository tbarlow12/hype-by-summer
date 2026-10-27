"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { usePathname } from "next/navigation";

/** A <details> disclosure that closes itself after client-side navigation. */
export function CloseOnNavigate(props: ComponentProps<"details">) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return <details ref={ref} {...props} />;
}
