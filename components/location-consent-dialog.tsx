"use client"

import { MapPinIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type LocationConsentDialogProps = {
  open: boolean
  onAllow: () => void
  onDeny: () => void
}

export function LocationConsentDialog({
  open,
  onAllow,
  onDeny,
}: LocationConsentDialogProps) {
  return (
    // Closing any other way (Esc, backdrop) counts as "No".
    <Dialog open={open} onOpenChange={(next) => !next && onDeny()}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader className="items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <MapPinIcon className="size-6" />
          </div>
          <DialogTitle className="text-lg">Use your location?</DialogTitle>
          <DialogDescription>
            We use it once to find your district and show what happened there.
            Your exact position isn&apos;t shown on the map or saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button variant="outline" className="sm:flex-1" onClick={onDeny}>
            No
          </Button>
          <Button className="sm:flex-1" onClick={onAllow}>
            Yes, enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
