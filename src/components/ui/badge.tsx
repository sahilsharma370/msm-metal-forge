import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        warning:
          "border-copper-bright/40 bg-copper-bright/10 text-copper-bright hover:bg-copper-bright/15",
        /**
         * CHECKPOINT C2L-V4b — restrained copper for purely informational
         * emphasis (e.g. a "Selling" intent tag), distinct from `warning`
         * (genuine alerts) even though the visual recipe is identical: a
         * solid `--primary` (raw copper) fill here would compete with the
         * page's real primary-CTA buttons, which is exactly what this
         * variant exists to avoid — translucent tint + subtle border +
         * readable copper text, never a second solid-orange treatment on
         * the same screen.
         */
        accent: "border-copper-bright/40 bg-copper-bright/10 text-copper-bright hover:bg-copper-bright/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
