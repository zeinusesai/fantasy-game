import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // MOBILE: a native-feeling bottom sheet, pinned to the bottom edge
          // with a drag-handle affordance. Desktop (sm:) reverts to the
          // original centred dialog, so nothing changes for large screens.
          //
          // `inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto` keeps long
          // content scrollable instead of clipped, and `rounded-t-2xl` gives
          // the sheet its silhouette.
          "bg-popover/95 animate-sheet-up fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] w-full gap-4 overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/10 p-5 pb-nav-safe shadow-[0_8px_32px_0_rgba(0,0,0,0.45)] backdrop-blur-2xl outline-none",
          "sm:animate-in sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:max-h-[90dvh] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-6 sm:pb-6 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:duration-200",
          className
        )}
        {...props}
      >
        {children}
        {/* Drag handle — sheet-only affordance, purely decorative. */}
        <span
          aria-hidden="true"
          className="bg-muted mx-auto absolute top-2 h-1 w-10 rounded-full sm:hidden"
        />
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 sm:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Full-width stacked buttons on mobile: easier thumb reach, no
        // cramped side-by-side targets.
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        "[&>button]:w-full [&>button]:py-3 [&>button]:text-base [&>button]:font-semibold [&>button]:rounded-xl sm:[&>button]:w-auto sm:[&>button]:py-2 sm:[&>button]:text-sm",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
